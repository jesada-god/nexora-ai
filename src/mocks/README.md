# Mock and fixture classification

| Location | Classification | Runtime use |
| --- | --- | --- |
| `marketData.ts` | Demo fixture | Bundled in the current frontend fallback and labelled “ข้อมูลสาธิต” in the UI |

No production, development-only, or test fixtures exist yet. Add future fixtures under an explicitly named directory and never import development/test fixtures into runtime code.
