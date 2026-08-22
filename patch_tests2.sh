sed -i 's/const fs1 = result.observations.find(o => o.pointId/const fs1 = result.observations.find((o: any) => o.pointId/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/const key = result/const _key = result/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/const getFeeScale/const _getFeeScale/g' metardu-v2/apps/desktop/src/tests/invoice-pdf.test.ts
