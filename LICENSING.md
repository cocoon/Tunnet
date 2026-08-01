# Tunnet Licensing Policy

Version 1.1

Tunnet uses different licenses for different components. This document defines
the repository's default path-based license map and the rules used to resolve
licensing information.

## 1. Order of precedence

The license applicable to a file is determined in this order:

1. A valid `SPDX-License-Identifier` in the file.
2. A valid adjacent `.license` file or an entry in `.reuse/dep5`.
3. Explicit package metadata for the component.
4. The default path-based map in this document.

Third-party material always retains its upstream license. A third-party notice
or license attached to a file overrides the Tunnet default for that file.

A directory-level label does not erase obligations created when components are
linked, combined, conveyed, or deployed together. Distributors must comply with
every license that applies to the material they distribute.

## 2. MPL-2.0 components

The following client-side, data-plane, embeddable, and customer-operated
components are licensed under MPL-2.0:

- `crates/tunnet-core`
- `crates/tunnet`
- `crates/tunnet-agent`
- `crates/tunnet-cli`
- `crates/tunnet-service`
- `crates/tunnet-node-napi`, including `@tunnet/sdk` and its native platform packages
- `crates/tunnet-kube-node`
- `crates/tunnet-operator`
- `crates/tunnet-posture`
- `apps/desktop`
- `packages/tunnet`

The MPL applies at file level. A proprietary larger work may use these
components, but modifications to MPL-covered files must remain available under
the MPL when the license requires source disclosure.

Tunnet does not mark these files as “Incompatible With Secondary Licenses”
unless a specific file expressly says otherwise.

## 3. Apache-2.0 components

The following protocol, client, contract, policy, tooling, and integration
surfaces are licensed under Apache-2.0:

- `crates/tunnet-common`, after the server-license module described below is removed
- `crates/tunnet-client`
- `crates/tunnet-policy-engine`
- `crates/tunnet-policy-napi`
- `packages/client`
- `packages/policy-engine`
- `packages/ip`
- `go/sdk`
- `go/terraform-provider-tunnet`
- `tools/gitops-policy-action`
- `tools/ci-templates`
- `scripts`
- `apps/docs`
- `crates/tunnet/examples`
- `helm/crds`
- `charts/tunnet-operator/crds`
- repository-level workflow support under `.github`

Generated clients and standalone public protocol schemas should also use
Apache-2.0 unless a generated file contains a different upstream notice.

## 4. AGPL-3.0-only components

The following control-plane, hosted-management, managed-edge, persistence, and
server-internal components are licensed under AGPL-3.0-only:

- `crates/tunnet-control`
- `crates/tunnet-relay`
- `crates/tunnet-audit`
- `apps/management`
- `apps/dashboard`
- `packages/api` until its public contracts are split into a separate Apache-2.0 package
- `packages/db`
- `packages/entitlements`
- `packages/env`
- `deploy`
- `charts/tunnet-operator`, except `charts/tunnet-operator/crds`
- `docker-compose.yml`

A modified AGPL network service must provide the source-access mechanism
required by AGPL-3.0-only. Official Tunnet web interfaces must contain a
prominent “Source” link that identifies the corresponding source for the
running version.

## 5. Required code-boundary changes

The license map above must not be represented as complete until these changes
are made:

1. Move `crates/tunnet-common/src/license.rs` and all deployment-license logic
   into an AGPL component such as `crates/tunnet-server-license`.
   `tunnet-common` cannot truthfully be distributed as Apache-2.0 while that
   AGPL/server-entitlement implementation remains compiled into it.

2. Split reusable public schemas and generated client contracts out of
   `packages/api` into an Apache-2.0 package such as `packages/protocol` or
   `packages/contracts`. Keep route implementations, authorization, internal
   APIs, and server business logic in the AGPL package.

3. Remove the workspace-wide Cargo `license` value. Every crate must declare
   its own SPDX identifier explicitly.

## 6. Commercial alternatives

Tunnet may offer a separate commercial license for:

- AGPL components used in closed-source control planes, hosted services,
  white-label deployments, OEM distributions, or closed modified relays.
- MPL components when a customer wants to keep modifications to MPL-covered
  files closed, or needs additional contractual rights, support, warranties,
  indemnities, certified builds, or trademark permissions.

Apache-2.0 components normally require no commercial license.

A commercial agreement is an alternative grant from the relevant copyright
holder. It does not alter the open-source license already granted to the
public.

## 7. Third-party materials

Third-party materials retain their own licenses and are not relicensed by this
document.

The official prebuilt `wintun.dll` must be obtained from the official Wintun
distribution and accompanied by the exact license included in that
distribution. It should be identified using a project-specific SPDX
`LicenseRef` if it is stored in the repository or release artifacts. Do not
replace its license with MPL, Apache, or AGPL text.

## 8. Repository compliance

Tunnet should follow the REUSE specification:

- Store standard texts in the uppercase `LICENSES/` directory.
- Add `SPDX-FileCopyrightText` and `SPDX-License-Identifier` information to
  each file, an adjacent `.license` file, or `.reuse/dep5`.
- Run `reuse lint` in CI.
- Include the applicable license text and notices in every published Cargo,
  npm, Go, container, installer, and binary distribution.
- Preserve all third-party notices.
