import Card, { CardBody } from "../components/Card";

export default function AboutPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">About SCC Library</h1>
        <p className="text-sm text-slate-500 mt-1">IS4234 governance prototype — 100% synthetic data.</p>
      </div>

      <Card>
        <CardBody className="space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">What is a Security Citation Code (SCC)?</h2>
            <p className="text-sm text-slate-600">
              A <strong>Security Citation Code (SCC)</strong> is a measurable security assertion tracked like a
              Service Level Agreement (SLA). Instead of a vague claim like "we maintain strong access controls,"
              an SCC captures a precise, time-bounded commitment — for example, "MFA is enforced on all privileged
              accounts, targeting 99% uptime over a 365-day rolling window."
            </p>
            <p className="text-sm text-slate-600 mt-2">
              Each SCC has a <strong>state</strong> at any point in time:
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600 list-none pl-0">
              <li className="flex items-center gap-2">
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-green-100 text-green-700 border-green-200">UPHELD</span>
                <span>All pinned controls are passing; the assertion is backed by evidence.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-red-100 text-red-700 border-red-200">DOWN</span>
                <span>One or more controls are failing; the assertion cannot currently be made.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-gray-100 text-gray-700 border-gray-200">UNKNOWN</span>
                <span>Evidence has not been collected yet or is stale.</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium border bg-slate-100 text-slate-500 border-slate-200">NOT_ACTIVE</span>
                <span>This version has been superseded or deprecated.</span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">SCC Versions</h2>
            <p className="text-sm text-slate-600">
              SCCs are versioned. When a security assertion needs to be strengthened or its parameters
              revised, the security lead submits a <strong>change request</strong> that an independent
              auditor must approve. The old version is <strong>SUPERSEDED</strong> and the new version
              becomes active. If an SCC is retired entirely, the latest version is <strong>DEPRECATED</strong>.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">What is a Citation?</h2>
            <p className="text-sm text-slate-600">
              A <strong>citation</strong> is a formally issued record of an SCC's performance over a
              specified period. Citations are formatted as APA-style strings such as:
            </p>
            <div className="mt-2 bg-slate-50 border border-slate-200 rounded px-4 py-3 font-mono text-xs text-slate-700">
              (SCC-01 v1, 2018: 99.0% upheld, target 99% met)
            </div>
            <p className="text-sm text-slate-600 mt-2">
              Citations can be generated for any completed period. Each citation includes the period,
              measured uptime percentage, and whether the target was met. Citations are hash-sealed
              and stored in the audit trail to prevent retroactive falsification.
            </p>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">Escalation Ladder</h2>
            <p className="text-sm text-slate-600">
              When an SCC stays DOWN, escalations fire automatically:
            </p>
            <table className="w-full text-sm mt-2 border-collapse">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1.5 pr-4 text-xs font-medium text-slate-500 w-10">Level</th>
                  <th className="text-left py-1.5 pr-4 text-xs font-medium text-slate-500">Assigned To</th>
                  <th className="text-left py-1.5 text-xs font-medium text-slate-500">Required Action</th>
                </tr>
              </thead>
              <tbody className="text-xs text-slate-600">
                {[
                  ["L1", "Control Owner", "Acknowledge and begin remediation"],
                  ["L2", "Security Lead", "Review and escalate if needed"],
                  ["L3", "Disclosure Committee", "Formal decision: REMEDIATE / STOP_CITING / REQUEST_REEVALUATION / DISCLOSE"],
                  ["L4", "Audit Committee", "Override or confirm L3 decision"],
                ].map(([level, role, action]) => (
                  <tr key={level} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-semibold text-purple-600">{level}</td>
                    <td className="py-2 pr-4">{role}</td>
                    <td className="py-2 text-slate-700">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 mb-2">The SolarWinds Case Study</h2>
            <p className="text-sm text-slate-600">
              This prototype walks through <strong>SolarWinds</strong> from December 2017 to
              December 2020, modelled on the governance failure patterns identified in the SolarWinds
              breach disclosure case. The data covers that company's security posture timeline and
              shows how the SCC Library would have surfaced the growing gap between security claims
              and evidence — audited by <strong>Meridian Assurance Group</strong>.
            </p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-amber-800 mb-1">Important Limitation</h3>
            <p className="text-xs text-amber-700">
              This system is a <strong>governance</strong> control. It would <strong>NOT</strong> have
              detected the SUNBURST build-server malware. SUNBURST was a supply-chain attack that
              compromised the build pipeline itself. No policy-to-evidence gate can detect malware
              embedded in compiled software. This prototype targets the <em>disclosure governance
              failure</em> — not the technical intrusion.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
