# LLVM L5 execution plan

1. Finish and freeze L1-L4 source, runtime, harness, tests and toolchain.
2. Complete a clean-tree full selfhost proof, including LLVM stages and every stage-aware suite.
3. Run fresh C-O2/C-O3/C-LTO/LLVM measurements together, serially, with one warmup and ten measured samples; record affinity and exact provenance.
4. Check all output validation and raw sample/median consistency. Evaluate the three approved performance gates and separately report noisy/inconclusive data.
5. Inspect retained binaries/optimized IR to determine whether LTO inlines hot runtime helpers. Do not add unproven attributes or change semantics for a benchmark.
6. Record docs/perf/llvm-decision.md, review the result independently, and retain C as default. A default change remains a later user decision.
