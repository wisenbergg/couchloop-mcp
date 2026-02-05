/**
 * Test the governance middleware
 */
import { governancePreCheck, governancePostCheck, withGovernance } from './middleware.js';

async function runTests() {
  console.log('=== Governance Middleware Tests ===\n');
  
  // Test 1: Package typosquat detection
  console.log('1. Package Command Check (typosquat):');
  const pkgResult = await governancePreCheck('run_in_terminal', { command: 'npm install lodas' });
  console.log('   Command: npm install lodas');
  console.log('   Issues:', JSON.stringify(pkgResult.issues));
  console.log('   Allowed:', pkgResult.allowed);
  
  // Test 2: Security scan - dangerous patterns
  console.log('\n2. Security Scan (dangerous patterns):');
  const secResult = await governancePreCheck('create_file', { 
    content: 'const apiKey = "sk-1234567890"; eval(userInput);' 
  });
  console.log('   Content: eval() + hardcoded secret');
  console.log('   Issues:', JSON.stringify(secResult.issues));
  console.log('   Allowed:', secResult.allowed);
  
  // Test 3: Post-execution code review
  console.log('\n3. Post-execution Code Review (console.log + empty catch):');
  const codeResult = await governancePostCheck('create_file', 
    'function test() { console.log("debug"); try { x() } catch(e) {} }'
  );
  console.log('   Issues:', JSON.stringify(codeResult.issues));
  console.log('   Allowed:', codeResult.allowed);
  
  // Test 4: Clean code should pass
  console.log('\n4. Clean Code (should pass):');
  const cleanResult = await governancePostCheck('create_file', 
    'function add(a: number, b: number): number { return a + b; }'
  );
  console.log('   Issues:', JSON.stringify(cleanResult.issues));
  console.log('   Allowed:', cleanResult.allowed);

  // Test 5: withGovernance wrapper
  console.log('\n5. withGovernance Wrapper Test:');
  const mockHandler = async (_args: Record<string, unknown>) => {
    return { success: true, data: 'created file' };
  };
  
  // Use enforce mode to actually block
  const enforceConfig = { enabled: true, mode: 'enforce' as const, preChecks: { validatePackages: true, scanSecurity: true }, postChecks: { preReviewCode: true, detectCodeSmell: false } };
  const wrappedHandler = withGovernance('create_file', mockHandler, enforceConfig);
  
  try {
    // This should fail pre-check due to eval
    await wrappedHandler({ content: 'eval(x)' });
    console.log('   ❌ Should have blocked eval');
  } catch (e: unknown) {
    console.log('   ✅ Correctly blocked:', (e as Error).message);
  }
  
  try {
    // This should pass
    const result = await wrappedHandler({ content: 'const x = 1;' });
    console.log('   ✅ Clean code passed:', JSON.stringify(result));
  } catch (e: unknown) {
    console.log('   ❌ Should have allowed:', (e as Error).message);
  }

  console.log('\n=== All Tests Complete ===');
}

runTests().catch(console.error);
