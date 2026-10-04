# LLVM measurement and decision (L5)

Implements issue #38's decision record without promoting a default backend.

Measure the frozen source with C-O2, C-O3, C-LTO and LLVM together. Every case has one verified warmup and at least five verified samples; configurations rotate and never execute concurrently. The final development run uses ten samples and records CPU affinity. Compiler emission-only and full native rebuild costs remain separate.

Choose one best whole-suite C configuration by geometric mean of runtime speedups. The LLVM median gates are: at least 1.10x suite speedup over that C configuration; no runtime case more than 5% slower; full self-build no slower. Report the fastest measured C self-build as a conservative additional comparison. Keep compiler-output verification separate from compiler conformance proof.

Raw samples and exact gate values are always visible. Fewer than five timed samples or a (max-min)/median spread over 20% in a compared runtime/full-self-build case makes the performance conclusion inconclusive. This is a conservative warning heuristic, not a confidence interval. It does not rewrite the approved median thresholds. No optimization or backend default change is justified by a noisy apparent win.

The historical baseline is retained for context, not spliced into the final LLVM comparison. C remains default while the user decides based on the measurements. Any proposed optimizer flag or IR change must be separately measured and retain L3/L4 parity before adoption.
