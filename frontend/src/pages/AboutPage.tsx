import Card, { CardBody } from "../components/Card";

export default function AboutPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">About Disclosure Gate</h1>
        <p className="text-sm text-slate-500 mt-1">IS4234 governance prototype — 100% synthetic data.</p>
      </div>

      <Card>
        <CardBody className="prose prose-sm prose-slate max-w-none">
          <h2 className="text-base font-semibold text-slate-800 mb-3">What is this?</h2>
          <p className="text-sm text-slate-600">
            Disclosure Gate demonstrates how a systematic, automated gate between internal security evidence
            and public security claims could surface contradictions earlier. Modelled on the SolarWinds case (2017–2020)
            using fictional company <strong>NimbusWatch Inc.</strong> with 100% synthetic data.
          </p>

          <h2 className="text-base font-semibold text-slate-800 mt-5 mb-3">Gaps Targeted</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 w-12">ID</th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500">Gap</th>
                <th className="text-left py-2 text-xs font-medium text-slate-500">Prototype Response</th>
              </tr>
            </thead>
            <tbody className="text-xs text-slate-600">
              {[
                ["G1", "Public claims never compared with internal evidence", "Claim Registry + Consistency Gate + drift re-check"],
                ["G2", "Escalation depended on individuals; stalled mid-chain", "Automatic ageing escalation (30/60/90 days)"],
                ["G3", "Same person owned security and the claims", "Independence rules on escalation and override"],
                ["G4", "Policies existed on paper; enforcement never tested", 'Automated control tests + "never tested = BLOCK"'],
                ["G5", "Risk acceptance disconnected from public claims", "Risk Acceptance Ledger tied to claims"],
                ["G6", "Incidents judged one at a time", "Incident Pattern Linker (stretch)"],
              ].map(([id, gap, resp]) => (
                <tr key={id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono font-bold text-blue-600">{id}</td>
                  <td className="py-2 pr-4">{gap}</td>
                  <td className="py-2 text-slate-700">{resp}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 bg-amber-50 border border-amber-200 rounded-md p-4">
            <h3 className="text-sm font-semibold text-amber-800 mb-1">Important Limitation</h3>
            <p className="text-xs text-amber-700">
              This system is a <strong>governance</strong> control. It would <strong>NOT</strong> have detected
              the SUNBURST build-server malware. SUNBURST was a supply-chain attack that compromised the build
              pipeline itself. No policy-to-evidence gate can detect malware embedded in compiled software.
              This prototype targets the disclosure governance failure — not the technical intrusion.
            </p>
          </div>

          <h2 className="text-base font-semibold text-slate-800 mt-5 mb-3">Presenter Talking Point</h2>
          <blockquote className="border-l-4 border-blue-500 pl-4 text-sm italic text-slate-600">
            "The gate doesn't stop a determined executive. It makes sure the gap between claim and evidence
            is visible to independent people, in time, and that keeping a contradicted claim live is a named,
            recorded decision."
          </blockquote>
        </CardBody>
      </Card>
    </div>
  );
}
