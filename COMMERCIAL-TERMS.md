# Pankha Commercial Terms

Copyright (c) 2024-2026 Pankha Fan Control

## Overview

Pankha Fan Management System is licensed for everyone under the Business Source License 1.1 (see [LICENSE](LICENSE)). You do not need to purchase anything to use Pankha, including for commercial self-hosting within your organization.

This document contains the terms for **paid tiers**. A paid tier does not change your rights to the source code; it unlocks additional capacity and entitlements in your deployment through a license token.

The current tiers and what each includes are published at https://pankha.app/#pricing and shown in the application's Settings page; those published definitions are the authoritative description of each tier at any given time. Tiers evolve together with the product, and the goal of every change is to keep Pankha Fan Control sustainable and improving for everyone.

Paid tiers fund Pankha's development.

## Tiers and Pricing

Pankha offers Free, Pro, and Enterprise tiers. For current pricing and tier limits, visit: https://pankha.app/#pricing

## Changes to Terms and Pricing

Pankha Fan Control may update these terms and pricing, and may add, change, rename, combine, or discontinue tiers and what each tier includes, at any time. Updated terms and tier definitions are published at https://pankha.app/#pricing and in this document, and take effect on publication.

Fees already paid are not affected: a change in price applies from your next purchase or renewal.

We aim for changes that add value rather than remove it, and significant changes are announced on GitHub.

## Grant

Upon purchase, you receive a license token that, while active, unlocks the capacity and entitlements of your purchased tier, and entitles you to priority issue triage (see Support).

## License Duration

- **Monthly**: Valid while the subscription is active. On cancellation, remains valid until the end of the current billing period (plus Grace Period), then the deployment reverts to the Free tier.
- **Yearly**: Valid for 1 year from purchase. Auto-renews unless cancelled; remains valid until the end of the current annual term on cancellation.
- **Lifetime**: Perpetual. Includes all future updates. Not transferable to another legal entity.

Licenses are non-transferable between legal entities. For legitimate corporate restructuring (acquisition, subsidiary transfer, entity name change), contact support@pankha.app for re-issuance at no additional charge.

## License Term and Effective Date

Your license term begins on the **date of purchase**, not the date you activate the token in the Pankha application. A Monthly license purchased on 2026-04-24 expires on 2026-05-24 regardless of when it was activated. The "Activated" timestamp shown in Settings reflects the date the token was issued upon payment. This keeps your license term aligned with your billing cycle.

## Grace Period

For Monthly and Yearly licenses, a **3-day grace period** follows the expiration date. During this window your license remains fully functional and the Pankha app displays renewal warnings. If not renewed within 3 days past expiration, the deployment reverts to the Free tier.

This grace period accommodates brief payment issues (expired card, bank delays, temporary payment-processor outages). It is not a trial extension and should not be relied upon for continuous operation.

Lifetime licenses do not expire and are not subject to the grace period.

## Expiration and Termination

Paid-tier entitlements apply only while the license is active. Upon expiration, cancellation, or termination:

1. Paid-tier capacity ceases and the deployment reverts to the Free tier
2. Connected agents beyond the Free tier's limit are not disconnected or hidden: they remain visible with live monitoring in **read-only mode**, and only fan control for them is disabled. Expiry never removes your view of your fleet
3. Your rights to use the software continue unchanged under the [LICENSE](LICENSE); nothing in this document affects them

Pankha Fan Control may suspend or terminate a paid license, and may decline to issue, re-issue, replace, renew, or transfer tokens to you or to any system you operate, with immediate effect and without notice, for: material breach of these terms; circumvention of or interference with license validation; token sharing, resale, or distribution; fraudulent, unlawful, or abusive use of the software or of support channels; a chargeback, payment reversal, or failed payment; or any use that harms or attempts to harm the service, its infrastructure, or other users. On termination your right to use paid-tier capacity ends immediately, whether or not the software continues to operate. Suspension or termination under this section does not entitle you to a refund.

## Restrictions

1. **Single Production Instance** - Each paid license covers one production deployment of the Pankha Fan Control server (the backend/hub instance used for real fan control by end users in one organization). Development, staging, and one disaster-recovery replica are included at no extra charge. Separate paid licenses are required to unlock paid-tier capacity on multiple independent production instances (e.g. two data centers, separately operated subsidiaries, multi-tenant hosting).

   Agents are not instances: you may install the Pankha agent on any number of machines. The number of agents concurrently connected to your server is governed by your tier's agent limit, not by this restriction.

2. **No Token Sharing or Resale** - License tokens are issued to you and may not be shared with, distributed to, or resold to third parties. (Redistribution of the software itself is governed by the [LICENSE](LICENSE), not by these terms.)

3. **No Sublicensing** - You may not grant, assign, or sublicense rights under this agreement to third parties.

4. **No Circumvention** - You may not modify, disable, or bypass license validation mechanisms. Doing so breaches these terms and the [LICENSE](LICENSE), terminates your paid license immediately without refund, and may constitute copyright infringement.

## Updates

- **Monthly/Yearly**: Updates included while the license is active
- **Lifetime**: All future updates included

## Support

Support is provided on a **best-effort basis** via GitHub Issues and email. No guaranteed response times. Paid tiers do not include an SLA.

**Priority**: Issues reported by active paid-tier holders are triaged before Free-tier and community issues when bandwidth is limited. Mention your tier (Pro / Enterprise) in the issue body to help with triage.

For critical issues, open a GitHub Issue: https://github.com/Anexgohan/pankha/issues

**Custom agreements**: A guaranteed response-time SLA, IP indemnification, security-vulnerability response commitments, purchase orders and invoicing, and vendor-onboarding paperwork are not included in the standard tiers, and can be arranged under a separate written agreement. Contact support@pankha.app.

## Purchase

To purchase a paid tier, visit: https://pankha.app/#pricing

Payments are processed by a third-party payment provider acting as merchant of record (currently Dodo Payments). The provider's terms govern payment processing, invoicing, and applicable taxes.

## Refunds

Refunds are available within 14 days of purchase if the software does not meet your requirements. Contact support@pankha.app.

## Warranty Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND TITLE. LIABILITY IS ADDRESSED SOLELY IN THE LIMITATION OF LIABILITY SECTION BELOW.

## Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, PANKHA FAN CONTROL'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SOFTWARE SHALL NOT EXCEED THE GREATER OF (A) THE FEES PAID BY YOU TO PANKHA FAN CONTROL IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, AND (B) FOR LIFETIME LICENSES, THE ONE-TIME FEE PAID. IN NO EVENT SHALL PANKHA FAN CONTROL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF DATA, LOSS OF PROFITS, BUSINESS INTERRUPTION, OR DAMAGE TO HARDWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

## Assignment and Change of Control

You may not assign or transfer these terms or your license token without prior written consent, except to a successor of all or substantially all of your business, on written notice to support@pankha.app.

Pankha Fan Control may assign these terms to a successor in interest to the project, including on a sale, merger, or transfer of the project's assets.

## Governing Law and Disputes

These terms are governed by and construed in accordance with the laws of India, without regard to conflict-of-law principles. The courts at Bengaluru, Karnataka, India have exclusive jurisdiction over any dispute, claim, or proceeding arising out of or relating to these terms or the software, and you consent to their exclusive jurisdiction and venue, except that Pankha Fan Control may bring proceedings against you in any court of competent jurisdiction.

Nothing in this section limits any non-waivable right you have under the mandatory consumer-protection law of your country of residence.

## General

**Survival**: The Restrictions, Warranty Disclaimer, Limitation of Liability, Assignment and Change of Control, and Governing Law and Disputes sections survive the expiration or termination of your license.

**Notices**: Notices to Pankha Fan Control go to support@pankha.app. Notices to you go to the email address associated with your purchase.

**Entire agreement**: These terms, together with the [LICENSE](LICENSE), are the entire agreement between us concerning paid tiers, and supersede any prior discussion or representation. They are replaced only by a separate written agreement signed by both parties.

**Severability**: If any provision of these terms is held unenforceable, that provision is limited to the minimum extent necessary and the remainder stays in full effect.

**No waiver**: A failure to enforce any provision is not a waiver of the right to enforce it later.

---

For questions about paid tiers, contact: support@pankha.app
