# Access Policies & ACLs

Tunnet enforces access control with organization guardrails and per-network policies. Policies define which peers can communicate, on which protocols and ports.

## Access mode (Open / Restricted)

Each **network** has an explicit access mode. This is independent of Managed vs Direct.

| Mode | Unmatched traffic | Typical rules |
|------|-------------------|---------------|
| **Open** (default for new networks) | Allow | Mostly denies (block guests, lock down prod) |
| **Restricted** | Deny | Mostly allows (least privilege) |

The mode never flips automatically when you add a rule. Switching Open → Restricted shows a confirmation; add allow rules before locking down production meshes.

Do **not** use a catch-all `deny any → any` to get Restricted. set the network access mode instead.

## Evaluation order

Deny always beats allow:

1. Organization **Deny** matches → Deny (hard guardrail; cannot be overridden by network allows)
2. Network **Deny** matches → Deny
3. Network **Allow** matches → Allow
4. Else → network default (Open = Allow, Restricted = Deny)

Organization **Allow** is not supported; org policies are deny-only guardrails.

ICMP is controlled by the network `icmp` policy setting (`allow` by default, or `acl` / `deny`).

## Policy structure

Each rule has a source, destination, action, optional protocol/ports, and optional source posture requirements. Selectors can be tags, endpoint IDs, CIDR ranges, users, or any.

Configure policies under **Access** (org deny guardrails) and **Networks → Access** (network rules + access mode). Use the policy wizard to set who, where, protocol, and ports (`80`, `443`, `8000-9000`, `*`).

## Tag-based ACLs

Assign tags to machines, then write policies like:

- Machines tagged `engineering` can reach `staging` on TCP/443
- Machines tagged `monitoring` can reach all machines on ports 9090–9100
- Guests are denied access to `production`

## ACL enforcement

The ACL engine runs on every agent. When a packet is destined for a peer, the source agent evaluates policy before forwarding. Denied packets are dropped locally.

Use **Explain / Simulate** on the network Access page to see which rule or default decision applies.

## SSH policies

SSH has a separate layer under **Networks → Access → SSH Rules**, including optional check-mode re-auth and session recording.

## Device posture

Policies can require the source device to pass named posture definitions. Configure under **Security → Posture**.

## Policy as Code

Author the same rules in HCL, JSON, or YAML; apply with the CLI or Terraform. See [Policy as Code](/guide/policy-as-code).
