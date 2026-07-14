# Homunculus — MVP Vision

*Source: project brief, July 2026. This is the north star document. It describes where the
product is going, not what is built today.*

---

## Vision

Homunculus is an AI-powered Clinical Intelligence Platform designed initially and
exclusively for **Intensive Care Units (ICU)** and **Neonatal Intensive Care Units (NICU)**.

The MVP does not diagnose patients autonomously. It is an intelligent clinical copilot that
continuously monitors critically ill patients in real time, detects deterioration early,
generates explainable recommendations, and alerts clinicians before life-threatening events
occur. It behaves as an always-on clinical assistant operating 24/7.

## Problem

ICU and NICU clinicians monitor dozens of continuously changing physiological parameters.
Even experienced physicians may overlook subtle trends under workload, fatigue, or sheer
data volume. Critical deterioration often begins hours before traditional alarms fire.
Bedside monitors generate threshold-based alarms; they do not understand the patient's
overall clinical condition. Homunculus continuously analyses all available patient data and
generates context-aware clinical intelligence.

## Scope of the MVP

Adult ICU and Neonatal ICU only. No other departments.

## Primary users

Intensivists · Neonatologists · ICU physicians · NICU physicians · Nurses · Rapid response
teams

## Core objective

Continuously monitor every ICU patient. Analyse patient data in real time. Predict
deterioration before conventional alarms. Notify clinicians immediately. **Explain every
recommendation.**

---

## Real-time device integration

Mechanical ventilators · Patient monitors · ECG monitors · Pulse oximeters · Blood pressure
monitors · Infusion pumps · Capnography devices · Temperature monitors · Blood gas analysers
· Laboratory information systems · Hospital information systems · Electronic medical records
· FHIR APIs · HL7 interfaces · Medical IoT gateways

The system ingests streaming clinical data with minimal latency.

## Data pipeline

```
Medical Device → Hospital Integration Layer → Device Gateway → Streaming Engine
    → Clinical AI Engine → Risk Engine → Recommendation Engine → Notification Service
    → Doctor Dashboard → Mobile Application
```

## Monitored signals

Heart rate · Respiratory rate · Blood pressure · SpO₂ · Temperature · ECG rhythm ·
Ventilator parameters (PEEP, FiO₂, tidal volume, minute ventilation, plateau pressure, peak
pressure, respiratory compliance, airway resistance) · End-tidal CO₂ · Urine output · Fluid
balance · Laboratory results · ABG results · Medication changes · Clinical notes · Nursing
notes · Patient history · Previous admissions

## What the AI evaluates

Patient stability · Clinical deterioration · Organ dysfunction · Sepsis probability ·
Respiratory failure · Ventilator complications · Cardiac instability · Renal failure ·
Electrolyte abnormalities · Fluid overload · Hypotension · Hypoxia · Hypercapnia · Acidosis ·
Shock · Neurological deterioration

---

## Intelligent alarms

Unlike threshold-based bedside alarms, Homunculus generates context-aware clinical alerts —
high sepsis risk, possible septic shock, deterioration detected, increasing respiratory
failure risk, ventilator settings may require adjustment, possible fluid overload, abnormal
blood gas trend, possible drug interaction, critical laboratory trend, high mortality risk.

**Every alert carries:** severity · confidence score · clinical reasoning · supporting
evidence · recommended actions · urgency level.

## Recommendation engine

The AI never issues direct medical orders. It provides evidence-based recommendations —
*consider repeat arterial blood gas · review ventilator settings · evaluate fluid
responsiveness · monitor lactate trend · assess possibility of sepsis · review antibiotic
coverage · repeat potassium measurement · review sedation level · evaluate extubation
readiness · consider chest imaging.*

**Every recommendation must explain why it was generated.**

## Notification

Hospital dashboard · doctor web portal · nurse dashboard · mobile app · push notifications ·
SMS (optional) · hospital internal messaging · future smartwatch support.

Notifications support **escalation**: an ignored alert escalates to another clinician after
configurable intervals.

## Clinical dashboard

Live patient list · risk score · current alarms · clinical timeline · ventilator data ·
vital signs · laboratory trends · medication timeline · recommendation history · AI
explanations · deterioration graph.

---

## Service architecture

Device Gateway · Streaming Service · Clinical Data Service · Patient Timeline Service · AI
Inference Service · **RAG Engine** · **Knowledge Base** · Clinical Rule Engine ·
Notification Service · Dashboard API · Authentication Service · Audit Logging · Monitoring

## Knowledge sources

International clinical guidelines · hospital protocols · ventilator manuals · drug
references · clinical rules · evidence-based medicine · medical literature.

**The AI must retrieve relevant knowledge before generating recommendations.**

## Technology stack

**Backend** — Python · FastAPI · PostgreSQL · Redis · Apache Kafka
**AI** — PyTorch · Transformers · vLLM · LangGraph · LlamaIndex · Qdrant
**Infrastructure** — Docker · Kubernetes · GitHub Actions
**Monitoring** — Prometheus · Grafana · OpenTelemetry

## Security

Every patient record encrypted. Every AI recommendation logged. Every action auditable.
Every user authenticated. Role-based access control mandatory. No patient data used for
model training without explicit approval and proper governance.

---

## MVP success criteria

Connect to ICU devices · receive live patient telemetry · analyse patient status
continuously · generate explainable clinical recommendations · produce intelligent alarms ·
notify clinicians in real time · display patient status on a live dashboard · operate
reliably with low latency in ICU and NICU environments.

## Long-term

After validating the ICU/NICU MVP: Emergency Department · Operating Rooms · General Wards ·
Cardiology · Oncology · Radiology · Pediatrics · Hospital Operations · Medical Research —
evolving into a full Clinical Intelligence Platform.

---

## Where we are now

**Building the second brain first.** Two components of the architecture above — the
**Knowledge Base** and the **RAG Engine** — are the ones that make every clinical
recommendation explainable. They also happen to be the only ones that can be built and
deliver value *before* device access, ethics approval, or patient data exist.

So the knowledge base comes first, as an LLM-maintained Obsidian vault under `Homunculus/`.
See [`superpowers/specs/2026-07-14-second-brain-design.md`](superpowers/specs/2026-07-14-second-brain-design.md)
for its design, and [`../CLAUDE.md`](../CLAUDE.md) for how it is operated.
