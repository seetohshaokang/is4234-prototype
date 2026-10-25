import streamlit as st
from ui_helpers import render_sidebar_role, render_sidebar_clock
from db import get_session

st.title("ℹ️ About Disclosure Gate")

with get_session() as session:
    render_sidebar_role()
    render_sidebar_clock(session)

st.markdown("""
## What is this?

**Disclosure Gate** is a governance prototype built for IS4234.
It demonstrates how a systematic, automated gate between internal security evidence
and public security claims could have surfaced contradictions earlier in a scenario
modelled on the SolarWinds case (2017–2020).

All data is **100% synthetic**. The company name, people, products and incidents are
fictional. This prototype is not affiliated with SolarWinds, Orion or any real entity.

---

## The Gaps It Targets

| ID | Gap | Prototype response |
|----|-----|--------------------|
| G1 | Public claims never compared with internal evidence | Claim Registry + Consistency Gate + drift re-check |
| G2 | Escalation depended on individuals; stalled mid-chain | Automatic ageing escalation (30/60/90 days) |
| G3 | Same person owned security *and* the claims | Independence rules on escalation and override |
| G4 | Policies existed on paper; enforcement never tested | Automated control tests + "never tested = BLOCK" |
| G5 | Risk acceptance disconnected from public claims | Risk Acceptance Ledger tied to claims |
| G6 | Incidents judged one at a time | Incident Pattern Linker (stretch) |

---

## Important Limitation

> **This system is a *governance* control. It would NOT have detected the SUNBURST
> build-server malware.** SUNBURST was a supply-chain attack that compromised the
> build pipeline itself. No policy-to-evidence gate can detect malware embedded in
> compiled software. This prototype targets the disclosure governance failure — not
> the technical intrusion.

---

## Framework Traceability

| Feature | Framework link |
|---------|---------------|
| Automated control tests, "never tested" rule | COSO – Monitoring Activities; COBIT MEA02; NIST 800-53 |
| Claim Registry + Consistency Gate + drift | COSO – Information & Communication; SOX disclosure accuracy |
| Independent escalation, conflict skip | Three Lines of Defence; COBIT Principle 4; MAS segregation of duties |
| Ageing escalation to Audit Committee | Board oversight duty; MAS Audit guideline |
| Risk Acceptance Ledger | ERM risk treatment — acceptance must be documented |
| Hash-chained audit trail | Agency theory — reduce information asymmetry; 3rd-line assurance |

---

## Presenter Talking Point

> *"The gate doesn't stop a determined executive. It makes sure the gap between claim
> and evidence is visible to independent people, in time, and that keeping a
> contradicted claim live is a named, recorded decision."*

---

*Prototype built for IS4234 · Synthetic data · Fictional company: NimbusWatch Inc.*
""")
