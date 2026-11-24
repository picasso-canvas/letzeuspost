import { FontManifestSchema, type FontSubset } from './manifest.ts';

// The launch font library (§08 Fonts): the Clean and Playful looks; Bold and Editorial follow in M8. Every file comes
// from an exact-version @fontsource package (OFL-1.1); only the normal styles and the Latin and Bengali subsets.

type Hashes = readonly (readonly [FontSubset, number, string])[];

/** The manifest entries of a package's files, one per [subset, weight, sha256]. */
const files = (font: string, hashes: Hashes) =>
  hashes.map(([subset, weight, sha256]) => ({
    weight,
    style: 'normal' as const,
    subset,
    path: `@fontsource/${font}/files/${font}-${subset}-${String(weight)}-normal.woff2`,
    sha256,
  }));

const ofl = (font: string) => ({ spdx: 'OFL-1.1' as const, path: `@fontsource/${font}/LICENSE` });

/** §07's minimums, to be tuned with the golden renders (§08). */
const banglaLineHeight = { body: 1.65, heading: 1.3 };

export const FONT_MANIFEST = FontManifestSchema.parse({
  fonts: [
    {
      family: 'Nunito',
      weights: [200, 300, 400, 500, 600, 700, 800, 900],
      languages: ['en'],
      licence: ofl('nunito'),
      files: files('nunito', [
        ['latin', 200, 'aead037b53b6e5291c3f9d77495b5078d02f3ddf41178731ba813ae6adda3107'],
        ['latin', 300, 'f647da08cb60587172d1d427b21790b62aea0554a40c6f15df53bad889ea0c20'],
        ['latin', 400, 'a5906e15ceb68f73d3b2c2076b4057c3f6ed401186d56283b45ce12944ca0735'],
        ['latin', 500, '23ae3083dbdaeabf3b9969a3947ddf5d5614683516e28ffa110ca4eb6192a9ff'],
        ['latin', 600, '45f437de32ff5973eb5616b43c1308bf9fe897442f3d78a603c4cd0a06d66573'],
        ['latin', 700, 'fa89300b9bbb3bd0f60d6991aa055965d98e2ccca27bf8688fe0c39cdc796846'],
        ['latin', 800, '2363d3ed037283ebb961e8c4b4917e40a8bc8853cf9965cf1ea7b4daa1df630a'],
        ['latin', 900, '9ca32f5d8334579387361096944286df451272a557bb09bd906254a623aba99e'],
      ]),
    },
    {
      family: 'Hind Siliguri',
      weights: [300, 400, 500, 600, 700],
      languages: ['bn'],
      licence: ofl('hind-siliguri'),
      banglaLineHeight,
      files: files('hind-siliguri', [
        ['bengali', 300, 'c54c5c125afe5e9e62391252bebf0b297a2f999d42d859701faba905679f2668'],
        ['bengali', 400, '8ae56aab7628191d874faef495d5229138187e8ed6061ede100fe362104faa91'],
        ['bengali', 500, '7f39fcb7fe45615aacae18c5f34e6da557bf8ad1222b1568402e1e2d80979038'],
        ['bengali', 600, 'b92b5da6d4f4f6de315f093f26a4e20d7ce7876a7db3ae7dda6a92fc5c3cc7c4'],
        ['bengali', 700, 'b6033f70da8e37d5b8a3065b0eaefaafa6003f72309864b0eeddaa926eb472c3'],
        ['latin', 300, 'efb4de66e674ca256f2ff25dc0c08f7c17f8bcf0c60173a57e06fb0fafe62fed'],
        ['latin', 400, 'cdc41415f366ef2966fc77e90d51391dec03657a6ed397fe59efd5ce34cf9549'],
        ['latin', 500, '50c07c577a7c527c2d471089cf3473bb90c7f010f8dfa343a45cf9e81fb4c5e8'],
        ['latin', 600, 'c39d0db6f570276765a06728ce87d83be5808ae403475ed6b49a64c02915805c'],
        ['latin', 700, 'e8f0fc0cabf50652d414fcb76a02c6a21d6bcfc19adcfd14453088a9dae1d970'],
      ]),
    },
    {
      family: 'Bagel Fat One',
      weights: [400],
      languages: ['en'],
      licence: ofl('bagel-fat-one'),
      files: files('bagel-fat-one', [
        ['latin', 400, '115ac5b80f2bd487ab5d5af59dd374261b6e81d00eda8361dd70e671d5aa35e4'],
      ]),
    },
    {
      family: 'Baloo 2',
      weights: [400, 500, 600, 700, 800],
      languages: ['en'],
      licence: ofl('baloo-2'),
      files: files('baloo-2', [
        ['latin', 400, '18ebcf63cd353f8472583e8261755fd527cddf0fdb5caa89dd2e60b4a9e4ba1c'],
        ['latin', 500, 'b533661a076cc6e6ecd387f4665a02e923f94eec48bfe5bcecaf29213eb29a36'],
        ['latin', 600, 'ffc22b431dcb01372be1986bc472bd400bbcb56b712a863c3abec7f8302e1bdd'],
        ['latin', 700, '8e7ffc9b993aa8caa89bcab81e103c9eb2da4e3e042f37b7a5115d0ddbff12c0'],
        ['latin', 800, '3e36c57e37bda5b5f28cf10636d6d3aed4de5250df923f1b203b64ad857c79a7'],
      ]),
    },
    {
      family: 'Baloo Da 2',
      weights: [400, 500, 600, 700, 800],
      languages: ['bn'],
      licence: ofl('baloo-da-2'),
      banglaLineHeight,
      files: files('baloo-da-2', [
        ['bengali', 400, '2503826a6576bf641b8ad6716bf88ff3a67fcd721f22a3c25394b9077b471c08'],
        ['bengali', 500, 'c48af7d1499e5c00bfc189d726472f99c4231eba7e667e35ec631a19a227497d'],
        ['bengali', 600, 'a847594a708c21972dfb7477f4b4db7e0e40217931843b8b691fb8a257afe886'],
        ['bengali', 700, 'b937d43c795fff2c63b45a08829dd459a29b9d23935e48bfe60958ee7b949c02'],
        ['bengali', 800, '98af9f0718d36a269fd6feee824a859c0400cde86e861d392bd5ef018ed798ef'],
        ['latin', 400, '9085331ce2906c707dafe74b4eefbde842d0d44521be05f631fb8247bea64c8c'],
        ['latin', 500, 'daa8cf77e9347c66c6ad044a80ee6ef37e24a8ffd9276ca2ca3dec27feaf0390'],
        ['latin', 600, '7c46007bba9a3161d62c6096c7fbce2b20b01078a1153da98f209847310c058a'],
        ['latin', 700, '71dda9472f45b8b4e0587b2836a8532d112ebe569d456fe26594d2c7632254a7'],
        ['latin', 800, 'b7538666ef00a05face7ddb2bfa1098af901c5c22af079a05071def34d36a699'],
      ]),
    },
  ],
  looks: {
    clean: {
      en: { heading: 'Nunito', body: 'Nunito' },
      bn: { heading: 'Hind Siliguri', body: 'Hind Siliguri' },
    },
    playful: {
      en: { heading: 'Bagel Fat One', body: 'Baloo 2' },
      bn: { heading: 'Baloo Da 2', body: 'Baloo Da 2' },
    },
  },
});
