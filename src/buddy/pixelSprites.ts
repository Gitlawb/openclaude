import chalk from 'chalk'
import type { Species } from './types.js'
import {
  corsair,
  ember,
  kage,
  kaio,
  merlin,
  robinhood,
  strawhat,
} from './types.js'

// Truecolor half-block pixel sprites. Each terminal cell renders two
// vertically stacked pixels via '▀' (fg = top pixel, bg = bottom pixel),
// so a 22×16-pixel sprite occupies 22 columns × 8 rows. chalk degrades
// rgb() to 256/16-color automatically at lower levels; below level 2 the
// art would render as uncolored blocks, so callers must gate on
// isPixelColorCapable() and fall back to the line-art sprites.
//
// Frames are palette-indexed strings: one char per pixel, '.' = transparent.
// All rows in a frame must be exactly PIXEL_WIDTH chars.

export const PIXEL_WIDTH = 22
const PIXEL_HEIGHT = 16

const PALETTE: Record<string, string> = {
  G: 'rgb(34,102,51)', // cap / tunic dark green
  g: 'rgb(72,158,74)', // tunic highlight green
  R: 'rgb(204,51,51)', // feather / vest / scarf red
  S: 'rgb(232,190,152)', // skin
  s: 'rgb(198,148,110)', // skin shadow
  E: 'rgb(38,34,32)', // eye
  H: 'rgb(122,82,46)', // hair brown
  B: 'rgb(112,74,40)', // bow / belt / boots brown
  b: 'rgb(158,112,66)', // quiver / bow highlight
  Y: 'rgb(214,168,60)', // gold trim / buckle
  W: 'rgb(240,240,240)', // eye glint / bowstring / white
  A: 'rgb(255,220,80)', // super-warrior gold hair / aura
  U: 'rgb(70,120,230)', // blue belt / boots / shorts
  w: 'rgb(235,238,245)', // white cloth (gi, shirt, beard)
  T: 'rgb(230,200,90)', // straw hat
  K: 'rgb(40,38,36)', // black hair / eyepatch
  P: 'rgb(120,70,190)', // deep purple robe/hat
  p: 'rgb(165,115,230)', // light purple highlight
  X: 'rgb(200,205,210)', // steel / silver
  N: 'rgb(70,74,82)', // ninja gi grey
  n: 'rgb(50,53,60)', // ninja gi dark
  D: 'rgb(190,50,40)', // dragon red dark
  d: 'rgb(235,90,60)', // dragon red bright
  C: 'rgb(245,220,170)', // cream belly / horns
  V: 'rgb(40,60,110)', // navy coat / tricorn
  O: 'rgb(255,140,40)', // flame orange accent
}

// Robin Hood faces LEFT (toward the prompt — the sprite sits on the right
// edge of the screen and arrows fly right→left). 22×16 pixels.
//
// Idle frame 0 — at rest, bow slung on the left arm.
const ROBIN_IDLE_0 = [
  '.......GGGGGG.........',
  '.....GGggggggGG.RR....',
  '....GGgggggggGGRRR....',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEWSSSEWSSs.......',
  '....SSSSSSSSSSs.......',
  '.....sSSSSSSs.........',
  '..B...GGggGGg.........',
  '..B..GgggggggG.bb.....',
  '..W..GgggggggG.bb.....',
  '..B...GBBYBBG..bb.....',
  '..B...GGgggGG.........',
  '.......GG.GG..........',
  '.......GG.GG..........',
  '......BBB.BBB.........',
]

// Idle frame 1 — blink (eyes closed to a line).
const ROBIN_IDLE_1 = [
  '.......GGGGGG.........',
  '.....GGggggggGG.RR....',
  '....GGgggggggGGRRR....',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEESSSEESSs.......',
  '....SSSSSSSSSSs.......',
  '.....sSSSSSSs.........',
  '..B...GGggGGg.........',
  '..B..GgggggggG.bb.....',
  '..W..GgggggggG.bb.....',
  '..B...GBBYBBG..bb.....',
  '..B...GGgggGG.........',
  '.......GG.GG..........',
  '.......GG.GG..........',
  '......BBB.BBB.........',
]

// Idle frame 2 — feather flutters, slight weight shift.
const ROBIN_IDLE_2 = [
  '.......GGGGGG.........',
  '.....GGggggggGG..RR...',
  '....GGgggggggGG.RRR...',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEWSSSEWSSs.......',
  '....SSSSSSSSSSs.......',
  '.....sSSSSSSs.........',
  '..B...GGggGGg.........',
  '..B..GgggggggG.bb.....',
  '..W..GgggggggG.bb.....',
  '..B...GBBYBBG..bb.....',
  '..B...GGgggGG.........',
  '......GG...GG.........',
  '......GG...GG.........',
  '.....BBB..BBB.........',
]

// Shoot frame 0 — nock: bow arm raises toward the left, arrow on string.
const ROBIN_SHOOT_0 = [
  '.......GGGGGG.........',
  '.....GGggggggGG.RR....',
  '....GGgggggggGGRRR....',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEWSSSEWSSs.......',
  '....SSSSSSSSSSs.......',
  '.....sSSSSSSs.........',
  '.B....GGggGGg.........',
  '.B.SSGgggggggG.bb.....',
  '.W.SSGgggggggG.bb.....',
  '.B....GBBYBBG..bb.....',
  '.B....GGgggGG.........',
  '.......GG.GG..........',
  '.......GG.GG..........',
  '......BBB.BBB.........',
]

// Shoot frame 1 — full draw: string pulled to the cheek, arrow level.
const ROBIN_SHOOT_1 = [
  '.......GGGGGG.........',
  '.....GGggggggGG.RR....',
  '....GGgggggggGGRRR....',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEWSSSEWSSs.......',
  'B...SSSSSSSSSSs.......',
  'B....sSSSSSSs.........',
  'B.WBBBBSSWWWWs........',
  'B.W..GgggggggG.bb.....',
  'B.W..GgggggggG.bb.....',
  'B.....GBBYBBG..bb.....',
  'B.....GGgggGG.........',
  '.......GG.GG..........',
  '.......GG.GG..........',
  '......BBB.BBB.........',
]

// Shoot frame 2 — loose: string forward, arm extended, arrow gone.
const ROBIN_SHOOT_2 = [
  '.......GGGGGG.........',
  '.....GGggggggGG.RR....',
  '....GGgggggggGGRRR....',
  '...GGGGGGGGGGGGGR.....',
  '.....HSSSSSSSH........',
  '....SEWSSSEWSSs.......',
  '....SSSSSSSSSSs.......',
  '.....sSSSSSSs.........',
  'BW.SSsGGggGGg.........',
  'BW...GgggggggG.bb.....',
  'BW...GgggggggG.bb.....',
  'B.....GBBYBBG..bb.....',
  'B.....GGgggGG.........',
  '.......GG.GG..........',
  '.......GG.GG..........',
  '......BBB.BBB.........',
]

// ── Kaio: gold spiky hair, white gi, blue belt/boots ────────────────────
const KAIO_IDLE_0 = [
  '.....A..A..A..........',
  '.....AAAAAAAA.........',
  '....AAAAAAAAAA........',
  '.....SSSSSSSS.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....wwwwwwwwww........',
  '...wwwwwwwwwwww.......',
  '...ww.wwwwww.ww.......',
  '...SS.UUUUUU.SS.......',
  '.....wwwwwwww.........',
  '.....ww....ww.........',
  '.....ww....ww.........',
  '....UUU....UUU........',
  '......................',
]
const KAIO_IDLE_1 = [
  '.....A..A..A..........',
  '.....AAAAAAAA.........',
  '....AAAAAAAAAA........',
  '.....SSSSSSSS.........',
  '....SEESSSEESs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....wwwwwwwwww........',
  '...wwwwwwwwwwww.......',
  '...ww.wwwwww.ww.......',
  '...SS.UUUUUU.SS.......',
  '.....wwwwwwww.........',
  '.....ww....ww.........',
  '.....ww....ww.........',
  '....UUU....UUU........',
  '......................',
]
// Charge: hands come together at the left, aura flickers.
const KAIO_SHOOT_0 = [
  '....A..A..A..A........',
  '.....AAAAAAAA.........',
  '....AAAAAAAAAA........',
  '.....SSSSSSSS.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '...wwwwwwwwwww........',
  '..wwwwwwwwwwwww.......',
  '..SSwwwwwwww.ww.......',
  '..SS.UUUUUUU.SS.......',
  '.....wwwwwwww.........',
  '.....ww....ww.........',
  '.....ww....ww.........',
  '....UUU....UUU........',
  '......................',
]
const KAIO_SHOOT_1 = [
  '..A..A..A..A..A.......',
  '....AAAAAAAAA.........',
  '...AAAAAAAAAAA........',
  '.....SSSSSSSS.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '..AAwwwwwwwwww........',
  '.AASSwwwwwwwwww.......',
  '.AASSwwwwwww.ww.......',
  '..AA.UUUUUUU.SS.......',
  '.....wwwwwwww.........',
  '.....ww....ww.........',
  '.....ww....ww.........',
  '....UUU....UUU........',
  '......................',
]
// Release: arms extended left, beam hands off to the FX row.
const KAIO_SHOOT_2 = [
  '....A..A..A..A........',
  '.....AAAAAAAA.........',
  '....AAAAAAAAAA........',
  '.....SSSSSSSS.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  'SSSSwwwwwwwwww........',
  'SSSSwwwwwwwwwww.......',
  '....wwwwwwww.ww.......',
  '.....UUUUUUU.SS.......',
  '.....wwwwwwww.........',
  '.....ww....ww.........',
  '.....ww....ww.........',
  '....UUU....UUU........',
  '......................',
]

// ── Strawhat: straw hat with red band, red vest, blue shorts ────────────
const STRAWHAT_IDLE_0 = [
  '......TTTTTT..........',
  '....TTTTTTTTTT........',
  '...TTTRRRRRRTTT.......',
  '..TTTTTTTTTTTTTT......',
  '.....KSSSSSSK.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....RRRRRRRRR.........',
  '...SSRRRRRRRSS........',
  '...SS.RRRRR.SS........',
  '.....UUUUUUU..........',
  '.....UU....UU.........',
  '.....SS....SS.........',
  '.....SS....SS.........',
  '....BBB....BBB........',
]
const STRAWHAT_IDLE_1 = [
  '......TTTTTT..........',
  '....TTTTTTTTTT........',
  '...TTTRRRRRRTTT.......',
  '..TTTTTTTTTTTTTT......',
  '.....KSSSSSSK.........',
  '....SEESSSEESs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....RRRRRRRRR.........',
  '...SSRRRRRRRSS........',
  '...SS.RRRRR.SS........',
  '.....UUUUUUU..........',
  '.....UU....UU.........',
  '.....SS....SS.........',
  '.....SS....SS.........',
  '....BBB....BBB........',
]
// Wind-up: arm pulls BACK (right) before the stretch punch.
const STRAWHAT_SHOOT_0 = [
  '......TTTTTT..........',
  '....TTTTTTTTTT........',
  '...TTTRRRRRRTTT.......',
  '..TTTTTTTTTTTTTT......',
  '.....KSSSSSSK.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....RRRRRRRRR.........',
  '....RRRRRRRRSSSS......',
  '...SS.RRRRR.SSSS......',
  '.....UUUUUUU..........',
  '.....UU....UU.........',
  '.....SS....SS.........',
  '.....SS....SS.........',
  '....BBB....BBB........',
]
const STRAWHAT_SHOOT_1 = [
  '......TTTTTT..........',
  '....TTTTTTTTTT........',
  '...TTTRRRRRRTTT.......',
  '..TTTTTTTTTTTTTT......',
  '.....KSSSSSSK.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '..SSRRRRRRRRR.........',
  'SSSSRRRRRRRRSS........',
  '......RRRRR.SS........',
  '.....UUUUUUU..........',
  '.....UU....UU.........',
  '.....SS....SS.........',
  '.....SS....SS.........',
  '....BBB....BBB........',
]
const STRAWHAT_SHOOT_2 = [
  '......TTTTTT..........',
  '....TTTTTTTTTT........',
  '...TTTRRRRRRTTT.......',
  '..TTTTTTTTTTTTTT......',
  '.....KSSSSSSK.........',
  '....SEWSSSEWSs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  'SSSSRRRRRRRRR.........',
  '....RRRRRRRRSS........',
  '......RRRRR.SS........',
  '.....UUUUUUU..........',
  '.....UU....UU.........',
  '.....SS....SS.........',
  '.....SS....SS.........',
  '....BBB....BBB........',
]

// ── Merlin: purple wizard hat with gold star, beard, robe, staff ────────
const MERLIN_IDLE_0 = [
  '.........PP...........',
  '........PPPP..........',
  '.......PPAPPP.........',
  '......PPPPPPPP........',
  '....PPPPPPPPPPPP......',
  '.....SSEWSSEWS........',
  '....wwSSSSSSSww.......',
  '....wwwwwwwwwww.......',
  '..B..PPPPPPPP.........',
  '..B.PPpppppPPP........',
  '..Y.PPpppppPPP........',
  '..B..PPPPPPPP.........',
  '..B..PPPPPPPP.........',
  '..B..PPPPPPPP.........',
  '..B.PPPPPPPPPP........',
  '......................',
]
const MERLIN_IDLE_1 = [
  '.........PP...........',
  '........PPPP..........',
  '.......PPAPPP.........',
  '......PPPPPPPP........',
  '....PPPPPPPPPPPP......',
  '.....SSEESSEES........',
  '....wwSSSSSSSww.......',
  '....wwwwwwwwwww.......',
  '..B..PPPPPPPP.........',
  '..B.PPpppppPPP........',
  '..Y.PPpppppPPP........',
  '..B..PPPPPPPP.........',
  '..B..PPPPPPPP.........',
  '..B..PPPPPPPP.........',
  '..B.PPPPPPPPPP........',
  '......................',
]
// Cast: staff raises left, tip glows.
const MERLIN_SHOOT_0 = [
  '.........PP...........',
  '........PPPP..........',
  '.......PPAPPP.........',
  '......PPPPPPPP........',
  '....PPPPPPPPPPPP......',
  '.....SSEWSSEWS........',
  '.B..wwSSSSSSSww.......',
  '.B..wwwwwwwwwww.......',
  '.B...PPPPPPPP.........',
  '.B.SPPpppppPPP........',
  '.Y.SPPpppppPPP........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '....PPPPPPPPPP........',
  '......................',
]
const MERLIN_SHOOT_1 = [
  '.A.......PP...........',
  '.YA.....PPPP..........',
  '.B.....PPAPPP.........',
  '.B....PPPPPPPP........',
  '.B..PPPPPPPPPPPP......',
  '.B...SSEWSSEWS........',
  '.B..wwSSSSSSSww.......',
  '.B.SwwwwwwwwwWw.......',
  '.B.S.PPPPPPPP.........',
  '...SPPpppppPPP........',
  '....PPpppppPPP........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '....PPPPPPPPPP........',
  '......................',
]
const MERLIN_SHOOT_2 = [
  '.A.A.....PP...........',
  '.AYA....PPPP..........',
  '.A.A...PPAPPP.........',
  '.B....PPPPPPPP........',
  '.B..PPPPPPPPPPPP......',
  '.B...SSEWSSEWS........',
  '.B..wwSSSSSSSww.......',
  '.B.SwwwwwwwwwWw.......',
  '.B.S.PPPPPPPP.........',
  '...SPPpppppPPP........',
  '....PPpppppPPP........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '.....PPPPPPPP.........',
  '....PPPPPPPPPP........',
  '......................',
]

// ── Kage: grey hood, eye slit, red scarf ────────────────────────────────
const KAGE_IDLE_0 = [
  '......NNNNNNN.........',
  '.....NNNNNNNNN........',
  '....NNnnnnnnnNN.......',
  '....NNSEWSSEWNN.......',
  '....NNnnnnnnnNN.......',
  '.....NNnnnnnNN........',
  '....RRRRRRRRR.........',
  '....NNNNNNNNNRR.......',
  '...NNNNNNNNNNNRR......',
  '...NN.NNNNNN.NN.......',
  '...ss.nnnnnn.ss.......',
  '.....NNNNNNN..........',
  '.....NN....NN.........',
  '.....NN....NN.........',
  '....nnn....nnn........',
  '......................',
]
const KAGE_IDLE_1 = [
  '......NNNNNNN.........',
  '.....NNNNNNNNN........',
  '....NNnnnnnnnNN.......',
  '....NNSEESSEENN.......',
  '....NNnnnnnnnNN.......',
  '.....NNnnnnnNN........',
  '....RRRRRRRRR.........',
  '....NNNNNNNNNRR.......',
  '...NNNNNNNNNNNRR......',
  '...NN.NNNNNN.NN.......',
  '...ss.nnnnnn.ss.......',
  '.....NNNNNNN..........',
  '.....NN....NN.........',
  '.....NN....NN.........',
  '....nnn....nnn........',
  '......................',
]
// Throw: arm whips left with the shuriken.
const KAGE_SHOOT_0 = [
  '......NNNNNNN.........',
  '.....NNNNNNNNN........',
  '....NNnnnnnnnNN.......',
  '....NNSEWSSEWNN.......',
  '....NNnnnnnnnNN.......',
  '.....NNnnnnnNN........',
  '....RRRRRRRRR.........',
  '..ssNNNNNNNNNRR.......',
  '.XssNNNNNNNNNNRR......',
  '.....NNNNNNN.NN.......',
  '.....nnnnnnn.ss.......',
  '.....NNNNNNN..........',
  '.....NN....NN.........',
  '.....NN....NN.........',
  '....nnn....nnn........',
  '......................',
]
const KAGE_SHOOT_1 = [
  '......NNNNNNN.........',
  '.....NNNNNNNNN........',
  '....NNnnnnnnnNN.......',
  '....NNSEWSSEWNN.......',
  '....NNnnnnnnnNN.......',
  '.....NNnnnnnNN........',
  'ss..RRRRRRRRR.........',
  'ssNNNNNNNNNNNRR.......',
  '...NNNNNNNNNNNRR......',
  '.....NNNNNNN.NN.......',
  '.....nnnnnnn.ss.......',
  '.....NNNNNNN..........',
  '.....NN....NN.........',
  '.....NN....NN.........',
  '....nnn....nnn........',
  '......................',
]
const KAGE_SHOOT_2 = [
  '......NNNNNNN.........',
  '.....NNNNNNNNN........',
  '....NNnnnnnnnNN.......',
  '....NNSEWSSEWNN.......',
  '....NNnnnnnnnNN.......',
  '.....NNnnnnnNN........',
  '....RRRRRRRRRR........',
  'ssssNNNNNNNNNRR.......',
  '...NNNNNNNNNNNRR......',
  '.....NNNNNNN.NN.......',
  '.....nnnnnnn.ss.......',
  '.....NNNNNNN..........',
  '.....NN....NN.........',
  '.....NN....NN.........',
  '....nnn....nnn........',
  '......................',
]

// ── Ember: small red dragon, cream belly, folded wings ──────────────────
const EMBER_IDLE_0 = [
  '.....C...C............',
  '....DDDDDDDD..........',
  '..DDDAEDDDDDDD........',
  '..DDDDDDDDDDDDD.......',
  '....dddddddddDDD......',
  '....DCCCCCCDD.DDD.....',
  '...DDCCCCCCDDDDDd.....',
  '...DDCCCCCCDDddd......',
  '...DDCCCCCCDD.........',
  '...DDDCCCCDDD.........',
  '....DDDDDDDDDd........',
  '.....DD..DD..dd.......',
  '....DDD..DDD..dd......',
  '......................',
  '......................',
  '......................',
]
const EMBER_IDLE_1 = [
  '.....C...C............',
  '....DDDDDDDD..........',
  '..DDDDEDDDDDDD........',
  '..DDDDDDDDDDDDD.......',
  '....dddddddddDDD......',
  '....DCCCCCCDD.DDD.....',
  '...DDCCCCCCDDDDDd.....',
  '...DDCCCCCCDDddd......',
  '...DDCCCCCCDD.........',
  '...DDDCCCCDDD.........',
  '....DDDDDDDDDd........',
  '.....DD..DD..dd.......',
  '....DDD..DDD..dd......',
  '......................',
  '......................',
  '......................',
]
// Breathe: head rears back, mouth opens, flame builds.
const EMBER_SHOOT_0 = [
  '.....C...C............',
  '....DDDDDDDD..........',
  '..DDDAEDDDDDDD........',
  '.ODDDDDDDDDDDDD.......',
  '....dddddddddDDD......',
  '....DCCCCCCDD.DDD.....',
  '...DDCCCCCCDDDDDd.....',
  '...DDCCCCCCDDddd......',
  '...DDCCCCCCDD.........',
  '...DDDCCCCDDD.........',
  '....DDDDDDDDDd........',
  '.....DD..DD..dd.......',
  '....DDD..DDD..dd......',
  '......................',
  '......................',
  '......................',
]
const EMBER_SHOOT_1 = [
  '.....C...C............',
  '....DDDDDDDD..........',
  '..DDDAEDDDDDDD........',
  'OODDDDDDDDDDDDD.......',
  '.OO.dddddddddDDD......',
  '....DCCCCCCDD.DDD.....',
  '..DDDCCCCCCDDDDDd.....',
  '..DDDCCCCCCDDddd......',
  '...DDCCCCCCDD.........',
  '...DDDCCCCDDD.........',
  '....DDDDDDDDDd........',
  '.....DD..DD..dd.......',
  '....DDD..DDD..dd......',
  '......................',
  '......................',
  '......................',
]
const EMBER_SHOOT_2 = [
  '.....C...C............',
  '....DDDDDDDD..........',
  '..DDDAEDDDDDDD........',
  '.ODDDDDDDDDDDDD.......',
  '..O.dddddddddDDD......',
  '....DCCCCCCDD.DDD.....',
  '...DDCCCCCCDDDDDd.....',
  '...DDCCCCCCDDddd......',
  '...DDCCCCCCDD.........',
  '...DDDCCCCDDD.........',
  '....DDDDDDDDDd........',
  '.....DD..DD..dd.......',
  '....DDD..DDD..dd......',
  '......................',
  '......................',
  '......................',
]

// ── Corsair: navy tricorn with gold trim, eyepatch, red coat ────────────
const CORSAIR_IDLE_0 = [
  '....VV.......VV.......',
  '.....VVVVVVVVV........',
  '....YYYYYYYYYYY.......',
  '.....VVVVVVVVV........',
  '.....SSSSSSSS.........',
  '....SEWSSSKKKs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....RRRRRRRRR.........',
  '...SSRwwwwwRSS........',
  '...SS.RYRYR.SS........',
  '.....RRRRRRR..........',
  '.....VV....VV.........',
  '.....VV....VV.........',
  '....VVV....VVV........',
  '......................',
]
const CORSAIR_IDLE_1 = [
  '....VV.......VV.......',
  '.....VVVVVVVVV........',
  '....YYYYYYYYYYY.......',
  '.....VVVVVVVVV........',
  '.....SSSSSSSS.........',
  '....SEESSSKKKs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '....RRRRRRRRR.........',
  '...SSRwwwwwRSS........',
  '...SS.RYRYR.SS........',
  '.....RRRRRRR..........',
  '.....VV....VV.........',
  '.....VV....VV.........',
  '....VVV....VVV........',
  '......................',
]
// Fire: cannon barrel appears at the left, recoil pose.
const CORSAIR_SHOOT_0 = [
  '....VV.......VV.......',
  '.....VVVVVVVVV........',
  '....YYYYYYYYYYY.......',
  '.....VVVVVVVVV........',
  '.....SSSSSSSS.........',
  '....SEWSSSKKKs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '.XX.RRRRRRRRR.........',
  '.XXSSRwwwwwRSS........',
  '.XX...RYRYR.SS........',
  '.....RRRRRRR..........',
  '.....VV....VV.........',
  '.....VV....VV.........',
  '....VVV....VVV........',
  '......................',
]
const CORSAIR_SHOOT_1 = [
  '....VV.......VV.......',
  '.....VVVVVVVVV........',
  '....YYYYYYYYYYY.......',
  '.....VVVVVVVVV........',
  '.....SSSSSSSS.........',
  '....SEWSSSKKKs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  'XXXXRRRRRRRRR.........',
  'XXXXSRwwwwwRSS........',
  'XXXX..RYRYR.SS........',
  '.....RRRRRRR..........',
  '.....VV....VV.........',
  '.....VV....VV.........',
  '....VVV....VVV........',
  '......................',
]
const CORSAIR_SHOOT_2 = [
  '....VV.......VV.......',
  '.....VVVVVVVVV........',
  '....YYYYYYYYYYY.......',
  '.....VVVVVVVVV........',
  '.....SSSSSSSS.........',
  '....SEWSSSKKKs........',
  '....SSSSSSSSSs........',
  '.....sSSSSSSs.........',
  '.XX.RRRRRRRRR.........',
  '.XXSSRwwwwwRSS........',
  '.XX...RYRYR.SS........',
  '.....RRRRRRR..........',
  '.....VV....VV.........',
  '.....VV....VV.........',
  '....VVV....VVV........',
  '......................',
]

const PIXEL_SPRITES: Partial<
  Record<Species, { idle: string[][]; shoot: string[][] }>
> = {
  [robinhood]: {
    idle: [ROBIN_IDLE_0, ROBIN_IDLE_1, ROBIN_IDLE_2],
    shoot: [ROBIN_SHOOT_0, ROBIN_SHOOT_1, ROBIN_SHOOT_2],
  },
  [kaio]: {
    idle: [KAIO_IDLE_0, KAIO_IDLE_1],
    shoot: [KAIO_SHOOT_0, KAIO_SHOOT_1, KAIO_SHOOT_2],
  },
  [strawhat]: {
    idle: [STRAWHAT_IDLE_0, STRAWHAT_IDLE_1],
    shoot: [STRAWHAT_SHOOT_0, STRAWHAT_SHOOT_1, STRAWHAT_SHOOT_2],
  },
  [merlin]: {
    idle: [MERLIN_IDLE_0, MERLIN_IDLE_1],
    shoot: [MERLIN_SHOOT_0, MERLIN_SHOOT_1, MERLIN_SHOOT_2],
  },
  [kage]: {
    idle: [KAGE_IDLE_0, KAGE_IDLE_1],
    shoot: [KAGE_SHOOT_0, KAGE_SHOOT_1, KAGE_SHOOT_2],
  },
  [ember]: {
    idle: [EMBER_IDLE_0, EMBER_IDLE_1],
    shoot: [EMBER_SHOOT_0, EMBER_SHOOT_1, EMBER_SHOOT_2],
  },
  [corsair]: {
    idle: [CORSAIR_IDLE_0, CORSAIR_IDLE_1],
    shoot: [CORSAIR_SHOOT_0, CORSAIR_SHOOT_1, CORSAIR_SHOOT_2],
  },
}

import type { FxRun } from './actionEffects.js'

// Same run contract as the FX row, plus a background for the ▀ lower pixel.
export type PixelRun = FxRun & {
  backgroundColor?: string
}

export function hasPixelSprite(species: Species): boolean {
  return PIXEL_SPRITES[species] !== undefined
}

export function pixelIdleFrameCount(species: Species): number {
  return PIXEL_SPRITES[species]?.idle.length ?? 0
}

export function pixelShootFrameCount(species: Species): number {
  return PIXEL_SPRITES[species]?.shoot.length ?? 0
}

/** True when the terminal can render colored pixel art (chalk approximates
 *  rgb() at level 2; level <2 would print uncolored blocks). */
export function isPixelColorCapable(): boolean {
  return chalk.level >= 2
}

// Exposed for tests — every frame must be a full PIXEL_WIDTH×PIXEL_HEIGHT
// grid of palette chars or '.'.
export function _allPixelFramesForTesting(
  species: Species,
): string[][] | undefined {
  const sprite = PIXEL_SPRITES[species]
  return sprite ? [...sprite.idle, ...sprite.shoot] : undefined
}

export function _paletteCharsForTesting(): ReadonlySet<string> {
  return new Set([...Object.keys(PALETTE), '.'])
}

/**
 * Render a pixel frame as rows of color runs. Each output row covers two
 * pixel rows via half-blocks; adjacent cells with identical colors merge
 * into a single run to keep the Text node count low.
 */
// Frames are finite and deterministic, so rendered runs are cached for the
// lifetime of the process — CompanionSprite calls this every animation tick
// (and on every parent re-render), and rebuilding run arrays each time is
// pure waste. Callers must treat the result as immutable.
const renderCache = new Map<string, PixelRun[][]>()

export function renderPixelSprite(
  species: Species,
  frame: number,
  mode: 'idle' | 'shoot',
): PixelRun[][] | null {
  const sprite = PIXEL_SPRITES[species]
  if (!sprite) return null
  const frames = sprite[mode]
  const clamped = Math.min(Math.max(frame, 0), frames.length - 1)
  const cacheKey = `${species}:${mode}:${clamped}`
  const cached = renderCache.get(cacheKey)
  if (cached) return cached
  const grid = frames[clamped]!

  const rows: PixelRun[][] = []
  for (let y = 0; y < PIXEL_HEIGHT; y += 2) {
    const top = grid[y]!
    const bottom = grid[y + 1]!
    const runs: PixelRun[] = []
    for (let x = 0; x < PIXEL_WIDTH; x++) {
      const topColor = PALETTE[top[x]!]
      const bottomColor = PALETTE[bottom[x]!]
      let cell: PixelRun
      if (topColor === undefined && bottomColor === undefined) {
        cell = { text: ' ' }
      } else if (topColor !== undefined && bottomColor !== undefined) {
        cell = { text: '▀', color: topColor, backgroundColor: bottomColor }
      } else if (topColor !== undefined) {
        cell = { text: '▀', color: topColor }
      } else {
        cell = { text: '▄', color: bottomColor }
      }
      const prev = runs[runs.length - 1]
      // Merge only when colors AND glyph match. (Blank cells have no colors,
      // so the color equality already restricts blank-merging to blank runs.)
      if (
        prev !== undefined &&
        prev.color === cell.color &&
        prev.backgroundColor === cell.backgroundColor &&
        prev.text[prev.text.length - 1] === cell.text
      ) {
        prev.text += cell.text
      } else {
        runs.push(cell)
      }
    }
    rows.push(runs)
  }
  renderCache.set(cacheKey, rows)
  return rows
}
