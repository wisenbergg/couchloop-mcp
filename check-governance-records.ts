#!/usr/bin/env npx tsx

import { getDb, initDatabase } from './src/db/client.js';
import { governanceEvaluations } from './src/db/schema.js';
import { desc } from 'drizzle-orm';

async function checkRecords() {
  await initDatabase();
  const db = getDb();

  const evals = await db
    .select()
    .from(governanceEvaluations)
    .orderBy(desc(governanceEvaluations.createdAt))
    .limit(5);

  console.log('Latest 5 Governance Evaluation Records:\n');

  evals.forEach((e, i) => {
    console.log(`Record ${i + 1}:`);
    console.log('  Session ID:', e.sessionId?.substring(0, 8) + '...');
    console.log('  Intervention Applied:', e.interventionApplied || 'none');

    const results = e.evaluationResults as any;
    console.log('  Evaluation Results:');

    if (results) {
      // Check for our simplified structure
      if (results.action) {
        console.log('    - Action:', results.action);
        console.log('    - Reason:', results.reason);
        console.log('    - Method:', results.method);
        console.log('    - Confidence:', results.confidence);
      } else {
        // Full structure
        console.log('    - Overall Risk:', results.overallRisk);
        console.log('    - Recommended Action:', results.recommendedAction);
        console.log('    - Confidence:', results.confidence);
        console.log('    - Unsafe Reasoning Detected:', results.unsafeReasoning?.detected);

        if (results.metadata) {
          console.log('    - Metadata Action:', results.metadata.action);
          console.log('    - Metadata Reason:', results.metadata.reason);
        }
      }
    }
    console.log('  Final Response:', e.finalResponse ? 'Yes' : 'No');
    console.log('---');
  });

  process.exit(0);
}

checkRecords().catch(console.error);