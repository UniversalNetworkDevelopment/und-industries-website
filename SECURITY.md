# UND Industries – Security Policy
Universal Network Development Industries (UND Industries)

## Overview
UND Industries operates AI‑driven digital systems, web applications, and automated services.  
Security is a core requirement of our infrastructure, development workflow, and product ecosystem.

This policy defines how vulnerabilities should be reported, how AI‑generated code is handled, and how production systems are protected.

---

## Supported Versions
The `main` branch is the only supported and deployable branch.

All production deployments must originate from `main` after passing:
- Automated tests  
- CodeQL scanning  
- Manual human review  
- Deployment approval  

---

## Reporting a Vulnerability
If you discover a security issue, please report it privately.

### Contact:
- Email: **undindustries@protonmail.com**
- GitHub: Use **Private Vulnerability Reporting** on this repository

Please include:
- A clear description of the issue  
- Steps to reproduce  
- Potential impact  
- Any suggested fixes (optional)

We will:
1. Acknowledge your report  
2. Investigate and validate the issue  
3. Patch the vulnerability  
4. Disclose responsibly if appropriate  

---

## AI‑Generated Code Policy
UND Industries uses internal AI systems to assist with development.  
To maintain security and integrity:

### AI Agents **May:**
- Create new branches  
- Open pull requests  
- Suggest code changes  
- Run tests in isolated environments  

### AI Agents **May NOT:**
- Push directly to `main`  
- Merge pull requests  
- Modify production deployment configuration  
- Access or modify secrets  
- Alter security logic or access control  
- Deploy to production  

### All AI‑generated code is treated as **untrusted** until:
- Reviewed by a human maintainer  
- All automated checks pass  
- CodeQL scanning passes  
- The PR is manually approved  

This ensures AI enhances productivity without compromising security.

---

## Dependency & Supply Chain Security
UND Industries uses Dependabot for automated dependency management.

Dependabot is configured to:
- Monitor npm dependencies  
- Monitor GitHub Actions  
- Apply weekly updates  
- Group security updates  
- Group minor/patch updates  
- Open PRs for all changes  

All dependency updates must:
- Be merged via pull request  
- Pass automated tests  
- Pass CodeQL scanning  
- Receive human approval  

---

## Secrets & Sensitive Data
Secrets must **never** be committed to the repository.

All secrets must be stored in:
- GitHub Actions Secrets  
- Hosting provider secret manager  
- Encrypted environment variables  

If a secret is accidentally exposed:
1. Rotate the secret immediately  
2. Revoke compromised keys  
3. Document the incident internally  
4. Review commit history for additional leaks  

Secret scanning is enabled to detect exposures.

---

## Production Environment Security
Production is a high‑security environment.

### Production rules:
- Only `main` can deploy to production  
- Deployments require manual approval  
- All deployments are logged and auditable  
- Direct access to production infrastructure is restricted  
- No AI agent may trigger or approve production deployments  

---

## Responsible Disclosure
UND Industries supports responsible disclosure.  
We do not pursue legal action against good‑faith security researchers who follow this policy.

---

## Contact
For all security matters:
- Email: **undindustries@protonmail.com**
