"""Preserve literal cells from three verified Lazada XLSX exports in a private JSON bundle.

Usage: python scripts/prepare-lazada-ads.py --overview FILE --campaigns FILE --products FILE --output reports/lazada-ads-YYYY-MM.input.json
No Sheet writes. Standard library only; identifiers and decimals remain source text.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def source(path):
    data = Path(path).read_bytes()
    if len(data) > 2_000_000:
        raise ValueError('Source exceeds 2 MB')
    with zipfile.ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > 20_000_000:
            raise ValueError('Expanded workbook exceeds limit')
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        sheets = [name for name in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name)]
        if len(sheets) != 1:
            raise ValueError('Expected one source worksheet')
        rows = []
        for row in ET.fromstring(archive.read(sheets[0])).findall('s:sheetData/s:row', NS):
            values = []
            for cell in row.findall('s:c', NS):
                if cell.find('s:f', NS) is not None or cell.get('t') == 'e':
                    raise ValueError('Formula/error cells are not supported')
                column = re.match(r'([A-Z]+)', cell.attrib['r'])[1]
                index = 0
                for letter in column:
                    index = index * 26 + ord(letter) - 64
                if index > 100:
                    raise ValueError('Unexpected column count')
                while len(values) < index:
                    values.append('')
                value = cell.findtext('s:v', default='', namespaces=NS)
                if cell.get('t') == 's':
                    value = shared[int(value)]
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(cell.find('s:is', NS).itertext())
                values[index-1] = value
            rows.append(values)
    return {'filename': Path(path).name, 'sha256': hashlib.sha256(data).hexdigest(), 'rows': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for kind in ['overview', 'campaigns', 'products', 'output']:
        parser.add_argument('--' + kind, required=True)
    args = parser.parse_args()
    exports = {kind: source(getattr(args, kind)) for kind in ['overview', 'campaigns', 'products']}
    meta = dict(row[:2] for row in exports['campaigns']['rows'][:5] if len(row) >= 2)
    shop_name, shop_id = meta['Seller Info'].rsplit('/', 1)
    start, end = meta['Duration'].replace('/', '-').split(' - ')
    bundle = {'schemaVersion': 1, 'platform': 'Lazada', 'shopName': shop_name, 'shopId': shop_id,
              'dateFrom': start, 'dateTo': end, 'currency': 'THB', 'timeZone': 'Asia/Bangkok', 'exports': exports}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation protects existing evidence; use a new name for revised exports.
    with output.open('x', encoding='utf-8') as handle:
        json.dump(bundle, handle, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'prepared': str(output), 'dateFrom': start, 'dateTo': end, 'files': len(exports)}))
