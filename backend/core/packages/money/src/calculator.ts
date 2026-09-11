import { databaseForScope, sql, uuid, type TenantDatabase } from '../../db/src/index.js';
import { Decimal, decimal, money, allocate } from './decimal.js';

export class FinancialDataError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
interface OrderRow {
  id: string; status: string; ordered_at: Date; recognized_at: Date | null;
  recognition_date: string | null; as_of: Date; as_of_date: string;
  period_start: string; period_end_exclusive: string;
}
interface Item {
  id: string; quantity: string; net_amount: string; vat_amount: string;
  unit_cost_snapshot: string | null; historical_unit_cost: string | null;
  cost_version_id: string | null; cogs_amount: string | null;
  returned_quantity: string; returned_net: string; returned_vat: string; restored_cogs: string;
}
interface LedgerRow { reporting_group: string; amount: string }
interface AllocationRow { day_count: string; day_rank: string; month_count: string; month_rank: string }
export interface ProfitResult {
  readonly companyId: string; readonly orderId: string; readonly currency: 'THB'; readonly timezone: 'Asia/Bangkok';
  readonly orderedAt: string; readonly recognizedAt: string; readonly recognitionDate: string; readonly asOf: string;
  readonly calculationBasis: 'ACCRUAL_WITH_ALLOCATED_OVERHEAD';
  readonly reportStatus: 'PROVISIONAL_ALLOCATION'; readonly warnings: readonly string[];
  readonly salesExVat: string; readonly creditNotesExVat: string; readonly netRevenueExVat: string;
  readonly vatAfterCredits: string; readonly gatewayFeesExVat: string; readonly netSalesAfterGatewayFees: string;
  readonly cogsSnapshot: string; readonly restoredCogs: string; readonly netCogs: string;
  readonly grossProfit: string; readonly contributionProfit: string;
  readonly allocatedAdSpend: string; readonly allocatedFixedCost: string; readonly allocatedOtherExpense: string;
  readonly netProfit: string; readonly netProfitBeforeIncomeTax: string; readonly netMarginPercent: string | null;
  readonly allocation: {
    readonly method: 'EQUAL_ORDER_COUNT_STABLE_SATANG_REMAINDER'; readonly monthStart: string;
    readonly monthEndExclusive: string; readonly monthOrderCount: string; readonly dayOrderCount: string;
    readonly adSpendPoolExVat: string; readonly fixedCostDayPoolExVat: string; readonly otherExpenseDayPoolExVat: string;
  };
  readonly cash: { readonly gatewayCollected: string; readonly refunded: string; readonly netGatewayCollected: string;
    readonly basis: 'GATEWAY_COLLECTION_NOT_BANK_CASH_FLOW' };
  readonly costSnapshots: readonly { readonly orderItemId: string; readonly versionId: string; readonly unitCost: string; readonly quantity: string }[];
}

export async function calculateActualProfit(companyId: string, orderId: string): Promise<ProfitResult> {
  return createProfitCalculator(databaseForScope())(companyId,orderId);
}
export function createProfitCalculator(db: TenantDatabase): (companyId: string, orderId: string) => Promise<ProfitResult> {
  return async (companyId,orderId) => {
    companyId=uuid(companyId); orderId=uuid(orderId); db.assertCompany(companyId);
    // One snapshot covers every source. Never combine reads from different
    // connections or dates while ads imports/payments are changing underneath.
    return db.transaction(async () => {
      const order = (await db.query<OrderRow>(sql`
        SELECT id,status,ordered_at,recognized_at,recognition_date::text,
          transaction_timestamp() AS as_of,(transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date::text AS as_of_date,
          date_trunc('month',recognition_date)::date::text AS period_start,
          least((date_trunc('month',recognition_date)+interval '1 month')::date,
            (transaction_timestamp() AT TIME ZONE 'Asia/Bangkok')::date+1)::text AS period_end_exclusive
        FROM app.orders WHERE company_id=${companyId} AND id=${orderId}`)).rows[0];
      if (!order) throw new FinancialDataError('ORDER_NOT_FOUND','Order is not visible in this company');
      if (order.status !== 'RECOGNIZED' || !order.recognized_at || !order.recognition_date || order.recognized_at > order.as_of) {
        throw new FinancialDataError('ORDER_NOT_RECOGNIZED','Profit requires a recognized sale, not merely an order or payment');
      }
      const items = (await db.query<Item>(sql`
        SELECT i.id,i.quantity,i.net_amount,i.vat_amount,i.unit_cost_snapshot,i.cost_version_id,i.cogs_amount,c.unit_cost AS historical_unit_cost,
          coalesce(r.quantity,0)::text AS returned_quantity,coalesce(r.net,0)::text AS returned_net,
          coalesce(r.vat,0)::text AS returned_vat,coalesce(r.cogs,0)::text AS restored_cogs
        FROM app.order_items i LEFT JOIN app.product_costs c
          ON c.company_id=i.company_id AND c.id=i.cost_version_id AND c.product_id=i.product_id
          AND c.valid_during @> ${order.recognized_at}::timestamptz
        LEFT JOIN LATERAL (
          SELECT sum(ci.quantity) quantity,sum(ci.net_amount) net,sum(ci.vat_amount) vat,sum(ci.restored_cogs) cogs
          FROM app.credit_note_items ci JOIN app.credit_notes cn ON cn.company_id=ci.company_id AND cn.id=ci.credit_note_id
          JOIN app.journal_entries e ON e.company_id=cn.company_id AND e.id=cn.journal_entry_id
          WHERE ci.company_id=i.company_id AND ci.order_item_id=i.id AND cn.order_id=${orderId}
            AND cn.recognized_on<=${order.as_of_date}::date AND e.status='POSTED' AND e.posted_at<=${order.as_of}
            AND NOT EXISTS (SELECT FROM app.journal_entries rev WHERE rev.company_id=e.company_id AND rev.reverses_entry_id=e.id AND rev.status='POSTED')
        ) r ON true WHERE i.company_id=${companyId} AND i.order_id=${orderId} ORDER BY i.line_number`)).rows;
      if (!items.length) throw new FinancialDataError('MISSING_ITEMS','Recognized order has no items');
      let sales=new Decimal(0), credits=new Decimal(0), vat=new Decimal(0), originalCogs=new Decimal(0), restored=new Decimal(0);
      const snapshots: { orderItemId:string;versionId:string;unitCost:string;quantity:string }[]=[];
      for (const item of items) {
        if (item.unit_cost_snapshot === null || item.historical_unit_cost === null || item.cost_version_id === null || item.cogs_amount === null ||
            !decimal(item.unit_cost_snapshot).equals(item.historical_unit_cost) ||
            !decimal(item.quantity).times(item.unit_cost_snapshot).toDecimalPlaces(2).equals(item.cogs_amount)) {
          throw new FinancialDataError('INVALID_COST_SNAPSHOT','Missing, mismatched or out-of-period historical cost');
        }
        if (decimal(item.returned_quantity).gt(item.quantity) || decimal(item.returned_net).gt(item.net_amount) ||
            decimal(item.returned_vat).gt(item.vat_amount) || decimal(item.restored_cogs).gt(item.cogs_amount)) {
          throw new FinancialDataError('INVALID_CREDIT_NOTE','Cumulative credit note exceeds original sale');
        }
        sales=sales.plus(item.net_amount); credits=credits.plus(item.returned_net);
        vat=vat.plus(item.vat_amount).minus(item.returned_vat);
        originalCogs=originalCogs.plus(item.cogs_amount); restored=restored.plus(item.restored_cogs);
        snapshots.push({orderItemId:item.id,versionId:item.cost_version_id,unitCost:item.unit_cost_snapshot,quantity:item.quantity});
      }
      // Reconcile source calculations with posted accounting, including complete
      // reversal chains. A source/ledger disagreement must not produce a profit.
      const ledger = (await db.query<LedgerRow>(sql`
        WITH RECURSIVE roots AS (
          SELECT e.id FROM app.journal_entries e WHERE e.company_id=${companyId} AND e.status='POSTED' AND
            ((e.source_kind='ORDER' AND e.source_id=${orderId})
            OR e.id IN (SELECT journal_entry_id FROM app.credit_notes WHERE company_id=${companyId} AND order_id=${orderId})
            OR e.id IN (SELECT f.journal_entry_id FROM app.gateway_fees f JOIN app.payments p ON p.company_id=f.company_id AND p.id=f.payment_id
                       WHERE p.company_id=${companyId} AND p.order_id=${orderId}))
        ), tree AS (
          SELECT id FROM roots UNION
          SELECT e.id FROM app.journal_entries e JOIN tree t ON e.reverses_entry_id=t.id
            WHERE e.company_id=${companyId} AND e.status='POSTED'
        )
        SELECT a.reporting_group,sum(CASE WHEN a.account_type='REVENUE' THEN l.credit-l.debit ELSE l.debit-l.credit END)::text AS amount
        FROM tree t JOIN app.journal_entries e ON e.id=t.id AND e.company_id=${companyId}
        JOIN app.journal_lines l ON l.company_id=e.company_id AND l.journal_entry_id=e.id
        JOIN app.accounts a ON a.company_id=l.company_id AND a.id=l.account_id
        WHERE e.accounting_date<=${order.as_of_date}::date AND e.posted_at<=${order.as_of}
          AND a.reporting_group IN ('SALES','SALES_RETURNS','COGS','GATEWAY_FEES') GROUP BY a.reporting_group`)).rows;
      const amountFor = (group: string): string => ledger.find(row=>row.reporting_group===group)?.amount ?? '0';
      const revenue=sales.minus(credits), cogs=originalCogs.minus(restored);
      if (!ledger.length || !decimal(amountFor('SALES')).plus(amountFor('SALES_RETURNS')).equals(revenue) || !decimal(amountFor('COGS')).equals(cogs)) {
        throw new FinancialDataError('LEDGER_SOURCE_MISMATCH','Posted revenue/COGS must reconcile with order and credit-note snapshots');
      }
      const feeRows = (await db.query<{ amount:string; n:string }>(sql`
        SELECT coalesce(sum(f.amount_ex_vat),0)::text AS amount,count(*)::text AS n FROM app.gateway_fees f
        JOIN app.payments p ON p.company_id=f.company_id AND p.id=f.payment_id
        JOIN app.journal_entries e ON e.company_id=f.company_id AND e.id=f.journal_entry_id
        WHERE f.company_id=${companyId} AND p.order_id=${orderId} AND e.status='POSTED'
          AND f.recognition_date<=${order.as_of_date}::date AND e.posted_at<=${order.as_of}
          AND NOT EXISTS (SELECT FROM app.journal_entries rev WHERE rev.company_id=e.company_id AND rev.reverses_entry_id=e.id AND rev.status='POSTED')`)).rows[0];
      const fees=decimal(feeRows?.amount ?? '0');
      if (!fees.equals(amountFor('GATEWAY_FEES'))) throw new FinancialDataError('FEE_LEDGER_MISMATCH','Gateway fee sources disagree with posted ledger');
      const population=(await db.query<AllocationRow>(sql`
        WITH population AS (
          SELECT id,recognition_date,count(*) OVER ()::text AS month_count,
            row_number() OVER (ORDER BY recognized_at,id)::text AS month_rank,
            count(*) OVER (PARTITION BY recognition_date)::text AS day_count,
            row_number() OVER (PARTITION BY recognition_date ORDER BY recognized_at,id)::text AS day_rank
          FROM app.orders WHERE company_id=${companyId} AND status='RECOGNIZED' AND recognized_at<=${order.as_of}
            AND recognition_date>=${order.period_start}::date AND recognition_date<${order.period_end_exclusive}::date
        ) SELECT day_count,day_rank,month_count,month_rank FROM population WHERE id=${orderId}`)).rows[0];
      if (!population) throw new FinancialDataError('INVALID_ALLOCATION','Order is missing from allocation population');
      const ad=(await db.query<{amount:string;n:string}>(sql`
        WITH latest AS (
          SELECT DISTINCT ON (campaign_id,spend_date) amount_ex_vat FROM app.ad_spends
          WHERE company_id=${companyId} AND spend_date>=${order.period_start}::date
            AND spend_date<${order.period_end_exclusive}::date AND imported_at<=${order.as_of}
          ORDER BY campaign_id,spend_date,revision DESC
        ) SELECT coalesce(sum(amount_ex_vat),0)::text AS amount,count(*)::text AS n FROM latest`)).rows[0];
      const fixed=(await db.query<{amount:string}>(sql`
        WITH costs AS (
          SELECT amount_ex_vat,frequency,
            CASE WHEN frequency='MONTHLY' THEN extract(day FROM ${order.recognition_date}::date)::numeric
                 WHEN frequency='YEARLY' THEN extract(doy FROM ${order.recognition_date}::date)::numeric ELSE 1 END AS day_number,
            CASE WHEN frequency='MONTHLY' THEN extract(day FROM date_trunc('month',${order.recognition_date}::date)+interval '1 month - 1 day')::numeric
                 WHEN frequency='YEARLY' THEN (make_date(extract(year FROM ${order.recognition_date}::date)::int+1,1,1)-make_date(extract(year FROM ${order.recognition_date}::date)::int,1,1))::numeric ELSE 1 END AS days
          FROM app.fixed_costs WHERE company_id=${companyId} AND starts_on<=${order.recognition_date}::date
            AND (ends_on IS NULL OR ends_on>${order.recognition_date}::date) AND created_at<=${order.as_of}
        ) SELECT coalesce(sum(round(amount_ex_vat*day_number/days,2)-round(amount_ex_vat*(day_number-1)/days,2)),0)::text AS amount FROM costs`)).rows[0];
      const other=(await db.query<{amount:string}>(sql`
        SELECT coalesce(sum(l.debit-l.credit),0)::text AS amount FROM app.journal_entries e
        JOIN app.journal_lines l ON l.company_id=e.company_id AND l.journal_entry_id=e.id
        JOIN app.accounts a ON a.company_id=l.company_id AND a.id=l.account_id
        WHERE e.company_id=${companyId} AND e.status='POSTED' AND e.accounting_date=${order.recognition_date}::date
          AND e.posted_at<=${order.as_of} AND a.reporting_group='OTHER_EXPENSE'`)).rows[0];
      const adPool=money(decimal(ad?.amount ?? '0')), fixedPool=money(decimal(fixed?.amount ?? '0')), otherPool=money(decimal(other?.amount ?? '0'));
      const adAllocation=allocate(adPool,population.month_rank,population.month_count);
      const fixedAllocation=allocate(fixedPool,population.day_rank,population.day_count);
      const otherAllocation=allocate(otherPool,population.day_rank,population.day_count);
      const gross=revenue.minus(cogs), contribution=gross.minus(fees);
      const profit=contribution.minus(adAllocation).minus(fixedAllocation).minus(otherAllocation);
      const cash=(await db.query<{ collected:string; refunded:string }>(sql`
        SELECT (SELECT coalesce(sum(amount),0)::text FROM app.payments WHERE company_id=${companyId} AND order_id=${orderId} AND status='SUCCEEDED' AND paid_at<=${order.as_of}) AS collected,
          (SELECT coalesce(sum(r.amount),0)::text FROM app.refunds r JOIN app.payments p ON p.company_id=r.company_id AND p.id=r.payment_id
            WHERE r.company_id=${companyId} AND p.order_id=${orderId} AND r.refunded_at<=${order.as_of}) AS refunded`)).rows[0];
      const warnings=['OVERHEAD_IS_ALLOCATED_NOT_DIRECTLY_ATTRIBUTED','AD_IMPORT_COMPLETENESS_NOT_CERTIFIED','INCOME_TAX_EXCLUDED'];
      if (feeRows?.n === '0') warnings.push('NO_GATEWAY_FEE_RECORDED_ZERO_IS_NOT_CONFIRMED');
      if (ad?.n === '0') warnings.push('NO_AD_SPEND_RECORDED_ZERO_IS_NOT_CONFIRMED');
      return {
        companyId,orderId,currency:'THB',timezone:'Asia/Bangkok',orderedAt:order.ordered_at.toISOString(),recognizedAt:order.recognized_at.toISOString(),
        recognitionDate:order.recognition_date,asOf:order.as_of.toISOString(),calculationBasis:'ACCRUAL_WITH_ALLOCATED_OVERHEAD',
        reportStatus:'PROVISIONAL_ALLOCATION',warnings,salesExVat:money(sales),creditNotesExVat:money(credits),netRevenueExVat:money(revenue),
        vatAfterCredits:money(vat),gatewayFeesExVat:money(fees),netSalesAfterGatewayFees:money(revenue.minus(fees)),
        cogsSnapshot:money(originalCogs),restoredCogs:money(restored),netCogs:money(cogs),grossProfit:money(gross),contributionProfit:money(contribution),
        allocatedAdSpend:adAllocation,allocatedFixedCost:fixedAllocation,allocatedOtherExpense:otherAllocation,
        netProfit:money(profit),netProfitBeforeIncomeTax:money(profit),netMarginPercent:revenue.isZero()?null:profit.div(revenue).times(100).toFixed(4),
        allocation:{method:'EQUAL_ORDER_COUNT_STABLE_SATANG_REMAINDER',monthStart:order.period_start,monthEndExclusive:order.period_end_exclusive,
          monthOrderCount:population.month_count,dayOrderCount:population.day_count,adSpendPoolExVat:adPool,fixedCostDayPoolExVat:fixedPool,otherExpenseDayPoolExVat:otherPool},
        cash:{gatewayCollected:money(decimal(cash?.collected ?? '0')),refunded:money(decimal(cash?.refunded ?? '0')),
          netGatewayCollected:money(decimal(cash?.collected ?? '0').minus(cash?.refunded ?? '0')),basis:'GATEWAY_COLLECTION_NOT_BANK_CASH_FLOW'},costSnapshots:snapshots,
      };
    },{isolation:'REPEATABLE READ',readOnly:true});
  };
}
