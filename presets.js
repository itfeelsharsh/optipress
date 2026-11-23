/**
 * OptiPress · presets.js
 * Crop / upload-size presets. Values are commonly cited requirements; the UI
 * always tells people to confirm with the issuing authority.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OptiPresets = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var IMAGE_PRESETS = [
    // ------------------------------------------------------ passport / visa --
    {
      id: 'us-passport',
      group: 'Passport & visa',
      label: 'US passport / DS-160',
      detail: '2 × 2 in · white background',
      width: 600,
      height: 600,
      maxKB: 240,
      background: 'white',
      fit: 'fill',
      note: 'US State Department digital photo. 600×600 px minimum, 240 KB maximum.'
    },
    {
      id: 'india-passport',
      group: 'Passport & visa',
      label: 'India passport / visa',
      detail: '35 × 45 mm · white background',
      width: 350,
      height: 450,
      maxKB: 1000,
      background: 'white',
      fit: 'fill',
      note: 'Passport Seva commonly asks for 35×45 mm on a white background; portal caps vary.'
    },
    {
      id: 'schengen',
      group: 'Passport & visa',
      label: 'Schengen visa',
      detail: '35 × 45 mm at 300 DPI',
      width: 413,
      height: 531,
      background: 'white',
      fit: 'fill',
      note: 'Standard Schengen visa photo, 35×45 mm.'
    },
    {
      id: 'uk-passport',
      group: 'Passport & visa',
      label: 'UK passport',
      detail: '35 × 45 mm · plain background',
      width: 600,
      height: 750,
      background: 'white',
      fit: 'fill',
      note: 'UK digital passport photo: at least 600×750 px, plain light background.'
    },
    {
      id: 'canada-passport',
      group: 'Passport & visa',
      label: 'Canada passport',
      detail: '50 × 70 mm at 300 DPI',
      width: 591,
      height: 827,
      background: 'white',
      fit: 'fill',
      note: 'Canadian passport photo, 50×70 mm.'
    },
    {
      id: 'australia-passport',
      group: 'Passport & visa',
      label: 'Australia passport',
      detail: '35 × 45 mm at 300 DPI',
      width: 413,
      height: 531,
      background: 'white',
      fit: 'fill',
      note: 'Australian passport photo, 35×45 mm.'
    },
    {
      id: 'china-visa',
      group: 'Passport & visa',
      label: 'China visa',
      detail: '33 × 48 mm · white background',
      width: 354,
      height: 472,
      maxKB: 120,
      background: 'white',
      fit: 'fill',
      note: 'Chinese visa photo, 33×48 mm; portal caps are commonly 40–120 KB.'
    },
    {
      id: 'japan-passport',
      group: 'Passport & visa',
      label: 'Japan passport',
      detail: '35 × 45 mm at 300 DPI',
      width: 413,
      height: 531,
      background: 'white',
      fit: 'fill',
      note: 'Japanese passport photo, 35×45 mm.'
    },

    // ------------------------------------------------------ government forms --
    {
      id: 'india-pan',
      group: 'Government forms',
      label: 'India PAN photo',
      detail: '213 × 213 px · 50 KB max',
      width: 213,
      height: 213,
      maxKB: 50,
      background: 'white',
      fit: 'fill',
      note: 'PAN application photo, commonly 213×213 px and 20–50 KB.'
    },
    {
      id: 'upsc-photo',
      group: 'Government forms',
      label: 'UPSC photo',
      detail: '350 × 450 px · 300 KB max',
      width: 350,
      height: 450,
      maxKB: 300,
      background: 'white',
      fit: 'fill',
      note: 'UPSC online application photo, commonly 350×450 px and 20–300 KB.'
    },
    {
      id: 'upsc-signature',
      group: 'Government forms',
      label: 'UPSC signature',
      detail: '140 × 60 px · 300 KB max',
      width: 140,
      height: 60,
      maxKB: 300,
      background: 'white',
      fit: 'fill',
      note: 'UPSC signature strip, commonly 140×60 px.'
    },
    {
      id: 'ssc-photo',
      group: 'Government forms',
      label: 'SSC photo',
      detail: '100 × 120 px · 50 KB max',
      width: 100,
      height: 120,
      maxKB: 50,
      background: 'white',
      fit: 'fill',
      note: 'SSC application photo, commonly 100×120 px and under 50 KB.'
    },

    // --------------------------------------------------------- social / web --
    {
      id: 'linkedin',
      group: 'Social & web',
      label: 'LinkedIn profile',
      detail: '400 × 400 px',
      width: 400,
      height: 400,
      background: 'white',
      fit: 'fill'
    },
    {
      id: 'github',
      group: 'Social & web',
      label: 'GitHub avatar',
      detail: '460 × 460 px',
      width: 460,
      height: 460,
      background: 'white',
      fit: 'fill'
    },
    {
      id: 'x-avatar',
      group: 'Social & web',
      label: 'X profile',
      detail: '400 × 400 px',
      width: 400,
      height: 400,
      background: 'white',
      fit: 'fill'
    },
    {
      id: 'instagram',
      group: 'Social & web',
      label: 'Instagram post',
      detail: '1080 × 1080 px',
      width: 1080,
      height: 1080,
      background: 'white',
      fit: 'fill'
    },
    {
      id: 'whatsapp',
      group: 'Social & web',
      label: 'WhatsApp profile',
      detail: '640 × 640 px',
      width: 640,
      height: 640,
      background: 'white',
      fit: 'fill'
    },
    {
      id: 'discord',
      group: 'Social & web',
      label: 'Discord avatar',
      detail: '128 × 128 px',
      width: 128,
      height: 128,
      background: 'white',
      fit: 'fill'
    },

    // -------------------------------------------------------- print / screen --
    {
      id: 'a4-300',
      group: 'Print & screens',
      label: 'A4 · 300 DPI',
      detail: '2480 × 3508 px',
      width: 2480,
      height: 3508,
      background: 'white',
      fit: 'fit'
    },
    {
      id: 'letter-300',
      group: 'Print & screens',
      label: 'US Letter · 300 DPI',
      detail: '2550 × 3300 px',
      width: 2550,
      height: 3300,
      background: 'white',
      fit: 'fit'
    },
    {
      id: 'hd',
      group: 'Print & screens',
      label: 'HD',
      detail: '1920 × 1080 px',
      width: 1920,
      height: 1080,
      background: 'black',
      fit: 'fit'
    },
    {
      id: '4k',
      group: 'Print & screens',
      label: '4K',
      detail: '3840 × 2160 px',
      width: 3840,
      height: 2160,
      background: 'black',
      fit: 'fit'
    },
    {
      id: 'square-2000',
      group: 'Print & screens',
      label: 'Square',
      detail: '2000 × 2000 px',
      width: 2000,
      height: 2000,
      background: 'white',
      fit: 'fill'
    }
  ];

  var PAGE_PRESETS = [
    { id: 'a4', label: 'A4', width: 595.28, height: 841.89 },
    { id: 'letter', label: 'US Letter', width: 612, height: 792 },
    { id: 'auto', label: 'Fit the image' }
  ];

  function byId(id) {
    for (var i = 0; i < IMAGE_PRESETS.length; i++) {
      if (IMAGE_PRESETS[i].id === id) return IMAGE_PRESETS[i];
    }
    return null;
  }

  function groups() {
    var order = [];
    var map = {};
    IMAGE_PRESETS.forEach(function (preset) {
      if (!map[preset.group]) {
        map[preset.group] = [];
        order.push(preset.group);
      }
      map[preset.group].push(preset);
    });
    return order.map(function (name) {
      return { name: name, items: map[name] };
    });
  }

  return {
    IMAGE_PRESETS: IMAGE_PRESETS,
    PAGE_PRESETS: PAGE_PRESETS,
    byId: byId,
    groups: groups
  };
});
