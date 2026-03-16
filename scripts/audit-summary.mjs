import fs from 'node:fs';

const [,, fullPath, prodPath] = process.argv;

function parseAudit(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const vulnerabilities = data.vulnerabilities || {};

  const summary = { low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const highs = [];

  for (const [name, vuln] of Object.entries(vulnerabilities)) {
    const severity = vuln.severity || 'low';
    if (summary[severity] !== undefined) summary[severity] += 1;
    summary.total += 1;

    if (severity === 'high' || severity === 'critical') {
      highs.push({
        name,
        severity,
        isDirect: Boolean(vuln.isDirect),
        isDev: Boolean(vuln.dev),
        effects: vuln.effects || [],
        fixAvailable: vuln.fixAvailable ?? null,
      });
    }
  }

  return { summary, highs };
}

function printReport(title, report) {
  console.log(`\n=== ${title} ===`);
  console.log(`total: ${report.summary.total}`);
  console.log(`low: ${report.summary.low} | moderate: ${report.summary.moderate} | high: ${report.summary.high} | critical: ${report.summary.critical}`);

  if (report.highs.length === 0) {
    console.log('No high/critical vulnerabilities.');
    return;
  }

  console.log('\nHigh/Critical packages:');
  for (const item of report.highs) {
    const fix = typeof item.fixAvailable === 'object'
      ? `${item.fixAvailable.name || 'unknown'}@${item.fixAvailable.version || 'latest'}`
      : String(item.fixAvailable);

    console.log(`- ${item.name} (${item.severity}) direct=${item.isDirect} dev=${item.isDev} fix=${fix}`);
    if (item.effects.length) {
      console.log(`  effects: ${item.effects.slice(0, 4).join(', ')}`);
    }
  }
}

const full = parseAudit(fullPath);
const prod = parseAudit(prodPath);

printReport('FULL (dev + prod)', full);
printReport('PRODUCTION ONLY', prod);
