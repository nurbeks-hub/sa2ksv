// Globe module: the three coats of the anterior/outer eye — cornea, conjunctiva, sclera.
// All geometry is built in the assembled pose, eye frame (mm): +Z anterior, +Y superior, +X nasal.
// Budget: 4 visible meshes -> 6 draw calls per frame (the cornea's transmission pre-pass re-draws the
// opaque sclera + lamina), invisible low-poly pick proxies (never drawn), ~181k triangles.
import { buildCornea } from './globe/cornea.js';
import { buildConjunctiva } from './globe/conjunctiva.js';
import { buildSclera } from './globe/sclera.js';
import { studioEnv } from './globe/env.js';

export function build(ctx) {
  const env = studioEnv();
  return [buildCornea(ctx, env), buildConjunctiva(ctx, env), buildSclera(ctx)];
}
