# ECDAT — Enterprise Cryptographic Discovery & Analysis Tool (`cryptolens`)

ECDAT discovers and continuously inventories cryptographic assets from connected cloud providers (**AWS Certificate Manager**) and authorized CSV/JSON/X.509 imports, evaluates deterministic UTC posture rules with traceable evidence, tracks remediation workflows, and exports formula-safe executive audit reports.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The **Northstar Sample Workspace** (`ws-sample`) works out of the box with fictional records and requires no credentials or login.

For production:

```bash
npm run build
NODE_ENV=production npm start
```

Run automated tests (`node:test`):

```bash
npm test
```

## Live Workspace & Enterprise Authentication

Live workspaces (`ws-live` / custom enterprise workspaces) enforce strict server-side authentication and RBAC (`Admin`, `Analyst`, `Viewer`) and contain **zero fictional records**.

Set these environment variables (or configure them in Cloud Run / AI Studio Secrets):

- `ECDAT_ENTERPRISE_AUTH_SECRET` — random secret string (at least 16 characters, e.g. `openssl rand -hex 32`) used to sign HMAC-SHA256 enterprise session tokens.
- `ECDAT_ENTERPRISE_USERS_JSON` — JSON array of enterprise user accounts with salted `scrypt` password hashes:
  ```json
  [
    {
      "email": "admin@yourcompany.com",
      "name": "Security Admin",
      "passwordHash": "scrypt:<16-byte-salt-hex>:<32-byte-hash-hex>",
      "workspaces": { "ws-live": "Admin" }
    }
  ]
  ```
- Generate a password hash locally using Node.js:
  ```bash
  node -e "const c=require('crypto'); const salt=c.randomBytes(16).toString('hex'); const hash=c.scryptSync('YOUR_PASSWORD', Buffer.from(salt,'hex'), 32).toString('hex'); console.log('scrypt:'+salt+':'+hash);"
  ```

## Connecting AWS Certificate Manager (ACM)

ECDAT uses `@aws-sdk/client-sts` and `@aws-sdk/client-acm` strictly server-side. Only **Admin** users inside a Live Workspace can create, modify, delete, or test Data Sources.

### Mode A: Cross-Account Access via STS `AssumeRole` + Unique External ID (Recommended)

1. In the target AWS account, create an IAM Role (e.g., `ecdat-acm-readonly`) with this **Trust Policy** (replace `<ECDAT_TRUSTED_PRINCIPAL_ARN>` with your ECDAT server IAM identity ARN and `<UNIQUE_EXTERNAL_ID>` with the External ID generated in ECDAT's **Data Sources** page):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowECDATCrossAccountReadOnlyAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<ECDAT_TRUSTED_PRINCIPAL_ARN>"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<UNIQUE_EXTERNAL_ID>"
        }
      }
    }
  ]
}
```

2. Attach this minimal **Read-Only Permissions Policy** to that role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECDATAcmInventoryReadOnly",
      "Effect": "Allow",
      "Action": [
        "acm:ListCertificates",
        "acm:DescribeCertificate"
      ],
      "Resource": "*"
    }
  ]
}
```

3. On the ECDAT server runtime, configure the trusted principal credentials (either via ECS/EKS/EC2 IAM Role, OIDC federation, or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) and optionally set `ECDAT_AWS_TRUSTED_PRINCIPAL_ARN` so the Data Sources UI pre-populates the exact trust policy JSON.

### Mode B: Same-Account Workload Identity

If ECDAT runs directly inside the target AWS account (ECS Task Role, EKS IRSA, EC2 Instance Profile, or server-side AWS env vars) with the read-only permissions policy above attached, select **Workload Identity** in Data Sources. ECDAT verifies identity with `sts:GetCallerIdentity` and enumerates ACM per region.

## Automatic 6-Hour Background Sync (Cloud Scheduler + Worker)

ECDAT supports two server-side scheduling options (and explicitly displays **"Schedule not configured"** until one is armed):

1. **Cloud Scheduler / External Cron (Recommended for Cloud Run)**:
   - Set `ECDAT_SCHEDULER_SECRET` (16+ random chars) in your server secrets.
   - Create a Cloud Scheduler HTTP job targeting `POST https://<YOUR_APP_URL>/api/internal/scheduled-sync` every 6 hours (`0 */6 * * *`) with header:
     `Authorization: Bearer <YOUR_ECDAT_SCHEDULER_SECRET>`
2. **Always-On In-Process Background Worker**:
   - Set `ECDAT_ENABLE_INTERNAL_SCHEDULER="true"` when running on a persistent Node.js server/VM (note: serverless containers that scale to zero should use Cloud Scheduler above).

## Storage & Sync Behavior

- **SQLite Persistence**: Uses built-in Node.js `node:sqlite` (`ECDAT_DB_PATH`, defaulting to `./data/ecdat.sqlite`).
- **Stable Identity & Manual Remediation Preservation**: Synced ACM certificates are keyed by `(workspaceId, sourceId, certificateArn)`. Re-syncs detect changes, re-run deterministic rules, and preserve existing manual `status`, `assignee`, `dueDate`, `acceptedReason`, and `remediation_history`.
- **Per-Region Failure Isolation**: If a region fails (`AccessDeniedException` or network timeout), previous snapshots are preserved untouched and missing-certificate detection only runs on regions that completed pagination and `DescribeCertificate` cleanly.
