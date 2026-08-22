sed -i 's/expect(result.observations\[0\]!.pointId/expect((result.observations\[0\] as any)!.pointId/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/expect(result.observations\[0\]!.faceLeft/expect((result.observations\[0\] as any)!.faceLeft/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/expect(result.observations\[0\]!.faceRight/expect((result.observations\[0\] as any)!.faceRight/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/expect(fs1!.faceLeft/expect((fs1 as any)!.faceLeft/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
sed -i 's/expect(fs1!.faceRight/expect((fs1 as any)!.faceRight/g' metardu-v2/apps/desktop/src/tests/instrument-import.test.ts
