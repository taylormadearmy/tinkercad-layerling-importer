# Selected-parts export

With nothing selected, the bookmark immediately exports the whole design.
When parts or groups are selected, it offers **Export whole design** or **Export selected parts**.
If the selection API is unavailable or fails, it keeps an explicit whole-design
choice instead of assuming an empty selection.
Select parts/groups before invoking the bookmark; use Shift-click for multiple
selections. Close and reopen the panel after changing the selection. If first-run
testkit activation reloads Tinkercad, reselect the parts and invoke it again.

## Selection API

On 25 October 2026, Tinkercad's public frontend identified asset version
`assets_v2_6v4pse`. Its
[`3dviewerBundle.js`](https://editor.tinkercad.com/assets_v2_6v4pse/js/3dviewerBundle.js)
contains `EditorTestKitModel` (webpack module 51670). The inspected file's SHA-256
is `07ad3bc0c27e35c171c2a3df110e77633bf4bd81199f9909a40fe1f82be329c7`.

| Method | Implementation in the inspected source |
| --- | --- |
| `getSelectionCount()` | Returns `selectionModel.objects.size()`. |
| `getSelectedAt(index)` | Returns `selectionModel.objects.getIndex(index)`, a selected scene-model object. |

The exporter feature-detects these read-only getters and snapshots each selected
model's `data.versions_id` before inserting the panel. It does not infer selection
from DOM elements, names, bounds, visibility or guessed navigation properties.
These are internal editor methods, not a stable public SDK.

## Capture boundaries

- Every selected identity must resolve to a unique, live node in
  `testKit.sceneModel`. Empty, unsupported, stale or ambiguous selections stop
  selected-only export; they never become whole-design exports.
- Scene-tree ancestry determines export roots. A selected descendant whose
  ancestor is also selected is not exported twice. Every selected root keeps its
  complete subtree, including hidden geometry and Boolean operands. Selecting an
  operand alone does not add an ancestor Boolean operation.
- Compact metadata reads only those roots. The metadata fallback filters to the
  exact selected-root identities and rejects a missing match. Geometry uses the
  existing world-transform and converter paths; filenames include `- selection`.
- Design-level spatial notes have no supported selected-part association and are
  omitted in selected-only mode. Whole-design note handling is unchanged.
- Geometry evaluation failures stop by default. A separate, explicitly confirmed
  partial-export choice can omit failed parts and whole affected Boolean groups.

The console API accepts `exportTinkercadDesign({scope: "selection"})`.
Omitting `scope` keeps whole-design capture as the default. The optional
`selectionIds` argument is an internal snapshot passed by the bookmark UI.

## Review and preview limits

Manual validation reported by TinkerBarn on 25 October 2026:

- Exporting one selected part in Safari succeeded; the exported file imported
  successfully into Layerling.
- Exporting multiple selected parts in Safari succeeded; that exported file also
  imported successfully into Layerling.

The exact tested bookmark build and Safari version were not recorded. These
reports establish the two manual cases above, rather than a separate verification
of every PR artifact or all group/Boolean and browser configurations. The original
PR had no automated verification. The integrated candidate adds synthetic tests
for selection snapshots, complete subtrees, overlap, stale/empty selection,
world coordinates and generated-bookmark downloads; this does not establish
live Tinkercad behavior in every browser.

The internal API was inspected in the public frontend source. An earlier automated
read-only Safari inspection was blocked because “Allow JavaScript from Apple
Events” was disabled; that limitation does not prevent manual bookmark use.
No browser security settings were changed during that inspection.

The integrated feature is included in v0.2.7. Replace an older self-contained
bookmark from the setup page to update it. The optional online bookmark and
**Run latest version** use the published runtime. The project owner reports
successful use of the integrated importer; this is separate from the earlier
contributor Safari report and the synthetic checks above.
