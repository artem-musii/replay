# Generated asset disclosure

Last inspected: **2026-08-27**.

REPLAY uses five original bitmap assets created during development with the Codex built-in image-generation mode. The built-in mode selected the available image model; it did not expose a model identifier in the returned artifact, so this repository does not claim a specific model snapshot. No API key is bundled, and the running application performs no image generation or external evidence upload.

The hero supports product communication. The other four images are fictional, synthetic demo evidence and are visibly badged **Synthetic demo** in the evidence inspector. They do not depict a real incident. The functional road, vehicles, paths, impact marker, damage markers, and branch overlays are authored as semantic SVG rather than generated pixels.

## Production files

| File                                                                                  | Purpose                               |  Dimensions |     WebP size | SHA-256                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------- | ----------: | ------------: | ------------------------------------------------------------------ |
| [`replay-hero.webp`](../public/assets/generated/replay-hero.webp)                     | Landing-page editorial product visual |  1672 × 941 | 346,630 bytes | `5b73a486d6bd062d80994a80d140904f78d7a1e071f523dd9f47a9e8c5659fca` |
| [`demo-roundabout-wide.webp`](../public/assets/generated/demo-roundabout-wide.webp)   | Wide fictional incident overview      | 1448 × 1086 | 239,890 bytes | `8d97209032313b37ffaf3a92142d4d254339c5d6ed19bd354888dae8c4c1b5ea` |
| [`demo-vehicle-a-damage.webp`](../public/assets/generated/demo-vehicle-a-damage.webp) | Vehicle A front-left damage detail    | 1448 × 1086 | 136,452 bytes | `27da729bfd9efdf78931d15423ef17253aa4d681faec7c6aaa03f2a4b9d5f0e9` |
| [`demo-vehicle-b-damage.webp`](../public/assets/generated/demo-vehicle-b-damage.webp) | Vehicle B rear-right damage detail    | 1448 × 1086 | 154,638 bytes | `b527745e962d163610cac7f3f6c529b35b9df28f32613165e2165307565cdeac` |
| [`demo-road-condition.webp`](../public/assets/generated/demo-road-condition.webp)     | Wet road-surface and marking detail   | 1448 × 1086 | 389,932 bytes | `e2179643bfd0bc5ebb74247abb839b8d3bb1a635ad8620846fd525c7ea3c8cc5` |

The optimized WebP set is approximately 1.2 MB. High-quality PNG generation outputs remain in the development host’s Codex generated-image artifact store, outside this repository, for reproducible re-encoding and close review. They are not copied into `public/` or `dist/`.

| Production asset             | Local source artifact                           |
| ---------------------------- | ----------------------------------------------- |
| `replay-hero.webp`           | `exec-b9fa34a2-242c-4efa-b729-026fae859dcc.png` |
| `demo-roundabout-wide.webp`  | `exec-436cbde8-955d-453c-b284-cfb10e157598.png` |
| `demo-vehicle-a-damage.webp` | `exec-aafaad40-06ff-4bdd-ab6c-3f147e89fad4.png` |
| `demo-vehicle-b-damage.webp` | `exec-c773221b-62dc-4831-a269-a6fe3119d64e.png` |
| `demo-road-condition.webp`   | `exec-4b5c884f-ef4a-49b1-a255-2ccad57feacc.png` |

## Recorded final prompts

### 1. Landing hero

> Create a premium 16:9 editorial hero image for REPLAY, a local-first incident reconstruction workspace. Wide top-down view of a compact European roundabout after light rain, two generic unbranded vehicles, one muted blue and one silver, with restrained overlaid trajectory lines, an incident timeline ribbon, small evidence-photo frames, and provenance nodes. Calm investigative notebook aesthetic, warm off-white paper tones, slate and teal palette, precise realistic geometry, generous negative space on the left for product copy, subtle photographic grain, sophisticated and trustworthy rather than dramatic. No people, no emergency vehicles, no collision spectacle, no injuries, no logos, no brands, no readable license plates, no watermark, no UI words or accidental text.

Purpose: explain REPLAY’s spatial, temporal, evidence, and provenance model at a glance without implying police, surveillance, or forensic authority.

### 2. Wide roundabout evidence

> Generate a wide documentary-style synthetic evidence photograph for a fictional minor road incident. Eye-level-to-slightly-elevated view across a wet compact European roundabout at overcast dusk, showing two generic cars in plausible post-contact positions: muted blue Vehicle A and silver Vehicle B. Light rain residue and reflective asphalt, ordinary street environment, calm neutral evidence framing, modest bumper-level proximity and no severe damage. Blank unreadable plates. No people, no responders, no logos, no brands, no readable signs, no watermark, no captions or accidental text.

Purpose: provide a broad, neutral demo reference for final positions, road context, and evidence linking.

### 3. Vehicle A damage

> Generate a close documentary synthetic evidence photograph of a generic muted blue compact car's front-left bumper and wheel arch after a minor low-speed incident. Show only plausible light scraping and scuff transfer, intact headlamp and wheel, neutral overcast daylight, wet pavement, clinically useful evidence composition, high detail without drama. Generic bodywork and blank unreadable plate if visible. No people or hands, no blood, no logos, no brand marks, no readable text, no watermark.

Purpose: support the seeded, human-confirmed observation that Vehicle A has minor front-left damage, without suggesting causal or fault analysis.

### 4. Vehicle B damage

> Generate a close documentary synthetic evidence photograph of a generic silver compact car's rear-right bumper and side corner after a minor low-speed incident. Show plausible light scraping and shallow scuff transfer, intact lamp and wheel, neutral overcast daylight, wet pavement, clinically useful evidence composition, high detail without drama. Generic bodywork and blank unreadable plate if visible. No people or hands, no blood, no logos, no brand marks, no readable text, no watermark.

Purpose: support the seeded, human-confirmed observation that Vehicle B has minor rear-right damage, without suggesting causal or fault analysis.

### 5. Wet road condition

> Generate a documentary synthetic evidence close-up of wet asphalt and road markings at a compact European roundabout after light rain. Show reflective dark pavement, droplets, a clean curved white lane marking and subtle tire sheen, neutral overcast light, factual evidence framing with realistic texture. No vehicles, no people, no debris, no logos, no readable signs or text, no watermark.

Purpose: support the seeded road-condition observation and demonstrate that evidence can be linked to an environmental fact as well as to a vehicle.

## Visual review record

Each final asset was opened at full composition and checked against the generation constraints before integration.

| Check                                                         | Hero | Wide scene | Vehicle A | Vehicle B | Road |
| ------------------------------------------------------------- | :--: | :--------: | :-------: | :-------: | :--: |
| No people or accidental body parts                            | Pass |    Pass    |   Pass    |   Pass    | Pass |
| No logos, brands, or trademarks                               | Pass |    Pass    |   Pass    |   Pass    | Pass |
| No readable licence plates                                    | Pass |    Pass    |   Pass    |   Pass    | N/A  |
| No captions, watermarks, or accidental readable text          | Pass |    Pass    |   Pass    |   Pass    | Pass |
| Vehicle colors match the seeded case                          | Pass |    Pass    |   Pass    |   Pass    | N/A  |
| Damage remains minor and plausible                            | N/A  |    Pass    |   Pass    |   Pass    | N/A  |
| Road layout/markings are plausible for the intended role      | Pass |    Pass    |    N/A    |    N/A    | Pass |
| No emergency imagery, injuries, or severe collision spectacle | Pass |    Pass    |   Pass    |   Pass    | Pass |

The wide overview is intentionally contextual rather than a geometry measurement. Generated perspective and vehicle placement are never used as collision-physics input. The SVG scene and explicit structured observations remain the operative reconstruction model.

## Integration and accessibility

- The landing image has descriptive alternative text covering the roundabout, vehicles, trajectories, evidence frames, timeline, and provenance nodes.
- Evidence-grid thumbnails use an empty `alt` because the adjacent visible filename is the accessible label for the selecting button. The selected evidence preview uses `alt="Preview of …"` with the asset name.
- Every synthetic demo item carries `syntheticDemoAsset: true`, includes `synthetic-demo` metadata, and shows an in-product **Synthetic demo** badge.
- The deterministic seed records each evidence asset’s exact `.webp` path, MIME type, byte size, and SHA-256 value from the production-file table above.
- Images are served from same-origin static paths. The app does not fetch them from the generation service.
- WebP is used for runtime delivery; functional visuals remain scalable, accessible SVG.

## Regeneration policy

Regenerate an asset if a future close review finds readable plate characters, a brand mark, accidental text, a person, implausible road geometry, severe damage, inconsistent vehicle color, or any detail that could make the synthetic image appear to document a real incident. Preserve the filename and update this file’s dimensions, byte count, checksum, prompt, and review table after replacement.
