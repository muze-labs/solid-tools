# Muze design principles

Muze builds web software for technically curious non-professional programmers, without making the tools unattractive to professionals.

We prefer:

- simplicity over completeness
- small, decoupled, single-concern libraries
- correct abstractions that do not cross conceptual boundaries
- browser-native standards where possible
- lightweight abstractions only when they make developer code simpler
- stable, long-term APIs
- components and frameworks that are easy to adapt or replace
- standards-based or open-source hosting stacks that avoid lock-in
- software small enough to work well on slow devices and connections
- a view-source philosophy: invite developers to look under the hood and learn

When making tradeoffs, prefer composability, replaceability, web-platform alignment, and long-term simplicity over convenience, popularity, or feature completeness.

## Muze package namespace policy

The `@muze-nl` npm namespace should be a trust signal. Packages published there should be close to production-ready: the public API is expected to be stable, the package can be installed and used by a fresh project, and the README should be clear about supported usage.

Experimental libraries should use the `@muze-labs` namespace until they are mature enough to carry the main Muze production-readiness signal. Moving from `@muze-labs` into `@muze-nl` should be treated as a release-readiness decision, not only a naming cleanup.

