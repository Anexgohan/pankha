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

Pankha Fan Control may update these terms, tier definitions, and pricing from time to time. Updated terms and tier definitions take effect when published, at https://pankha.app/#pricing and in this document. Pricing changes never affect what you have already paid: a new price applies from your next purchase or renewal. We aim for changes that add value rather than remove it, and significant changes are announced on GitHub.

## Grant

Upon purchase, you receive a license token that, while active, unlocks the capacity and entitlements of your purchased tier, and entitles you to priority issue triage (see Support).

## License Duration

- **Monthly**: Valid while the subscription is active. On cancellation, remains valid until the end of the current billing period (plus Grace Period), then the deployment reverts to the Free tier.
- **Yearly**: Valid for 1 year from purchase. Auto-renews unless cancelled; remains valid until the end of the current annual term on cancellation.
- **Lifetime**: Perpetual, non-revocable. Includes all future updates. Not transferable to another legal entity.

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

Pankha Fan Control may terminate a paid license for material breach of these terms, including circumvention of license validation. Termination for breach does not entitle the licensee to a refund.

## Restrictions

1. **Single Production Instance** - Each license covers one production deployment of the Pankha Fan Control server (the backend/hub instance used for real fan control by end users in one organization). Development, staging, and one disaster-recovery replica are included at no extra charge. Separate licenses are required for multiple independent production instances (e.g. two data centers, subsidiary companies, multi-tenant hosting).

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

## Purchase

To purchase a paid tier, visit: https://pankha.app/#pricing

Payments are processed by a third-party payment provider acting as merchant of record (currently Dodo Payments). The provider's terms govern payment processing, invoicing, and applicable taxes.

## Refunds

Refunds are available within 14 days of purchase if the software does not meet your requirements. Contact support@pankha.app.

## Warranty Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY ARISING FROM THE SOFTWARE.

## Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, PANKHA FAN CONTROL'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SOFTWARE SHALL NOT EXCEED THE GREATER OF (A) THE FEES PAID BY YOU TO PANKHA FAN CONTROL IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, AND (B) FOR LIFETIME LICENSES, THE ONE-TIME FEE PAID. IN NO EVENT SHALL PANKHA FAN CONTROL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION LOSS OF DATA, LOSS OF PROFITS, BUSINESS INTERRUPTION, OR DAMAGE TO HARDWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

## Governing Law and Disputes

These terms are governed by and construed in accordance with the laws of the jurisdiction in which the author of Pankha Fan Control (the Licensor) maintains their principal place of business or residence, without regard to conflict-of-law principles. Any dispute, claim, or proceeding arising out of or relating to these terms or the software shall be brought exclusively in the courts of that jurisdiction, and you consent to their exclusive jurisdiction and venue.

---

For questions about paid tiers, contact: support@pankha.app
