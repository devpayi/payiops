import express from 'express';
import { randomUUID } from 'node:crypto';
import type { TenantDatabase } from '../../../packages/db/src/index.js';
import { calculateActualProfit, FinancialDataError } from '../../../packages/money/src/index.js';
import { tenant, principalFor, requirePermission, type TenantOptions } from './middleware/tenant.js';
import { idempotency, transactionalWebhookHandler } from './middleware/idempotency.js';
import { verifyPaymentWebhook, type Provider, type SecretResolver } from './modules/integrations/verification.js';
import { paymentProcessor } from './modules/integrations/payments.js';
import { HttpError, errorHandler } from './http/errors.js';
import { ProcurementService } from './modules/procurement/service.js';
import { procurementRoutes } from './modules/procurement/routes.js';
import { ProcurementLine } from './modules/procurement/line.js';
import { authRoutes, type LocalAuth } from './modules/auth.js';
import type { ClassifierOptions } from './modules/procurement/classifier.js';
import { operationsRoutes, catalogRoutes } from './modules/operations.js';
import { settingsRoutes } from './modules/settings.js';
export interface AppOptions { readonly db:TenantDatabase; readonly jwt:TenantOptions; readonly secrets:SecretResolver; readonly localAuth?:LocalAuth; readonly classifier?:ClassifierOptions; readonly publicWebUrl?:string }
export function createApp({db,jwt,secrets,localAuth,classifier,publicWebUrl}:AppOptions): express.Express {
  const app=express();
  app.disable('x-powered-by'); app.set('etag',false);
  app.use((_req,res,next)=>{res.set('X-Request-Id',randomUUID());res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();});
  for (const provider of ['STRIPE','OMISE','2C2P'] as const satisfies readonly Provider[]) {
    app.post(`/webhooks/${provider.toLowerCase()}/:companyId/:routeId`,
      express.raw({type:'application/json',limit:'256kb',inflate:false}),
      verifyPaymentWebhook(db,provider,secrets),idempotency(db),transactionalWebhookHandler(db,paymentProcessor(db)));
  }
  const procurement=new ProcurementService(db,classifier);
  const line=new ProcurementLine(procurement,secrets,publicWebUrl??'http://localhost:3000');
  app.post('/webhooks/line/:companyId/:routeId',express.raw({type:'application/json',limit:'256kb',inflate:false}),line.webhook);
  app.use(express.json({limit:'8mb'}));
  if(localAuth)app.use('/auth',authRoutes(db,localAuth));
  app.use('/catalog',catalogRoutes(db));
  app.use('/api/ops',tenant(db,jwt),operationsRoutes(db,jwt.issuer));
  app.use('/api/settings',tenant(db,jwt),settingsRoutes(db));
  app.use('/api/procurement',tenant(db,jwt),procurementRoutes(procurement));
  app.get('/health/live',(_req,res)=>{res.json({status:'ok'});});
  app.get('/api/orders/:orderId/profit',tenant(db,jwt),requirePermission(db,'finance.profit.read'),async(req,res)=>{
    const principal=principalFor(req);
    const orderId=req.params['orderId'];
    if (typeof orderId !== 'string') throw new HttpError(400,'INVALID_ORDER_ID','Order id required');
    try { res.json(await calculateActualProfit(principal.companyId,orderId)); }
    catch (error) {
      if (error instanceof FinancialDataError) throw new HttpError(error.code==='ORDER_NOT_FOUND'?404:409,error.code,error.message);
      throw error;
    }
  });
  app.use((_req,res)=>{res.status(404).json({error:'NOT_FOUND'});});
  app.use(errorHandler);
  return app;
}
