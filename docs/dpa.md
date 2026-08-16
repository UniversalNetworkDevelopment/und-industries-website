# DATA PROCESSING AGREEMENT (DPA)
**Effective Date:** August 15, 2026  
**Data Controller:** Customer ("Customer")  
**Data Processor:** Universal Network Development LLC (d/b/a U.N.D Industries) ("Company")  
**Jurisdiction:** State of Florida, USA / GDPR & EU Standard Contractual Clauses (SCCs)  

---

## 1. BACKGROUND AND PURPOSE
This Data Processing Agreement ("DPA") supplements the Master Services Agreement ("MSA") or Terms of Use between Company and Customer. This DPA governs the processing of personal data ("Personal Data") in connection with Company's delivery of cloud services, APIs, and digital software products.

---

## 2. SCOPE AND PROCESSING INSTRUCTIONS
1. **Scope:** Company shall process Personal Data solely on behalf of and in accordance with documented instructions from Customer, including fulfilling service orders, user authentication, and billing.
2. **Categories of Data:** Name, email address, IP address, user ID, device hardware fingerprints (SHA-256), and transaction records.
3. **Categories of Data Subjects:** Customer's employees, authorized users, and end customers.

---

## 3. TECHNICAL AND ORGANIZATIONAL MEASURES
Company shall implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including:
- **Encryption:** Transport Layer Security (TLS 1.3 / HTTPS) in transit and AES-256 encryption at rest.
- **Access Control:** Role-Based Access Control (RBAC) and Multi-Factor Authentication (MFA) for administrative access.
- **Password Security:** Salted password hashing (Argon2id/bcrypt) via authentication provider.

---

## 4. SUBPROCESSOR MANAGEMENT & 30-DAY NOTICE
1. **Authorized Subprocessors:** Customer authorizes Company to engage the subprocessors listed in Annex A.
2. **30-Day Notice:** Company shall notify Customer of any intended changes concerning the addition or replacement of subprocessors at least **thirty (30) days** prior to onboarding. Customer may object to new subprocessors on reasonable data protection grounds within fourteen (14) days of notice.

---

## 5. 72-HOUR BREACH NOTIFICATION
Company shall notify Customer of any confirmed Personal Data breach affecting Customer data without undue delay and, in any event, within **seventy-two (72) hours** of discovery. The notification shall describe:
- The nature of the breach and estimated number of affected data subjects.
- Remediation measures taken or planned by Company.
- Recommended actions for Customer to mitigate potential adverse effects.

---

## 6. DATA SUBJECT RIGHTS & ASSISTANCE
Company shall reasonably assist Customer in responding to requests from data subjects exercising their rights under GDPR, CCPA, or applicable privacy law (access, correction, erasure, portability) within thirty (30) days.

---

## 7. DATA RETENTION AND ERASURE
Upon termination of services or Customer's verified request, Company shall delete or irreversibly anonymize all Personal Data within **thirty (30) days**, except where retention is mandated by applicable statutory, tax, or legal hold requirements.

---

# ANNEX A — AUTHORIZED SUBPROCESSORS LIST

| Subprocessor | Purpose | Location | Security / Transfer Mechanism |
|---|---|---|---|
| **Supabase Inc.** | User Authentication & Database Infrastructure | USA / EU | EU SCCs / SOC2 Type II |
| **Stripe Inc.** | Payment Processing & Fraud Prevention | USA | PCI-DSS Level 1 / EU SCCs |
| **Cloudflare Inc.** | CDN, DNS, Bot Protection & Hosting | Global / USA | EU SCCs / ISO 27001 |
| **Resend Inc.** | Transactional Email Dispatch | USA | SOC2 Type II / EU SCCs |

---

# ANNEX B — EU STANDARD CONTRACTUAL CLAUSES (MODULE 2: CONTROLLER TO PROCESSOR)
Where Personal Data originating from the European Economic Area (EEA), United Kingdom, or Switzerland is transferred to the United States, the EU Standard Contractual Clauses (Commission Implementing Decision (EU) 2021/914) are incorporated by reference and apply automatically.
