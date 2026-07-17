export interface ScadExample {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const EXAMPLES: ScadExample[] = [
  {
    id: "phone-stand",
    name: "Phone stand",
    description: "A printable stand with an adjustable viewing angle and cable slot.",
    source: `/* [Phone] */
phone_width = 78;   // Width of your phone [55:1:110]
phone_depth = 12;   // Phone + case thickness [7:0.5:22]
lip_height = 14;    // Front retaining lip [8:1:28]

/* [Stand] */
angle = 68;         // Viewing angle [45:1:82]
base_depth = 82;    // Front-to-back footprint [55:1:120]
wall = 5;           // Structural wall thickness [3:0.5:9]
cable_slot = 14;    // Charging cable opening [8:1:24]
stand_width = max(45, phone_width - 8);
$fn = 48;

module rounded_bar(size, radius = 3) {
  hull() {
    for (x = [radius, size[0] - radius])
      for (y = [radius, size[1] - radius])
        translate([x, y, 0]) cylinder(h = size[2], r = radius);
  }
}

difference() {
  union() {
    // Stable base
    rounded_bar([stand_width, base_depth, wall], 4);

    // Angled back support
    translate([0, base_depth - wall, wall])
      rotate([angle - 90, 0, 0])
        rounded_bar([stand_width, 82, wall], 3);

    // Front lip
    translate([0, 8, wall])
      rounded_bar([stand_width, phone_depth + wall, lip_height], 3);
  }

  // Cable access through the lip and base
  translate([(stand_width - cable_slot) / 2, 0, wall])
    cube([cable_slot, 28, lip_height + 2]);
}`,
  },
  {
    id: "storage-bin",
    name: "Storage bin",
    description: "A parametric open-top organizer for a desk or workshop.",
    source: `/* [Size] */
width = 80;       // Outside width [30:1:180]
depth = 60;       // Outside depth [30:1:180]
height = 45;      // Overall height [15:1:120]

/* [Construction] */
wall = 2.4;       // Wall thickness [1.2:0.2:5]
corner = 5;       // Corner radius [1:1:15]
floor = 3;        // Bottom thickness [1:0.5:8]
$fn = 40;

module rounded_box(size, radius) {
  hull() {
    for (x = [radius, size[0] - radius])
      for (y = [radius, size[1] - radius])
        translate([x, y, 0]) cylinder(h = size[2], r = radius);
  }
}

difference() {
  rounded_box([width, depth, height], corner);
  translate([wall, wall, floor])
    rounded_box(
      [width - 2 * wall, depth - 2 * wall, height + wall],
      max(1, corner - wall)
    );
}`,
  },
  {
    id: "calibration",
    name: "Calibration piece",
    description: "A compact primitive and boolean-operation test model.",
    source: `size = 24;       // Body size [10:1:50]
hole = 8;        // Through-hole diameter [2:0.5:18]
rounding = 3;    // Corner rounding [1:0.5:6]
$fn = 36;

difference() {
  hull() {
    for (x = [-1, 1])
      for (y = [-1, 1])
        translate([x * (size/2 - rounding), y * (size/2 - rounding), 0])
          cylinder(h = size / 2, r = rounding, center = true);
  }
  cylinder(h = size, d = hole, center = true);
}`,
  },
  {
    id: "name-tag",
    name: "Printable name tag",
    description: "Raised custom text on a rounded tag with an optional keyring hole.",
    source: `/* [Label] */
label = "MAKER";       // Text to print
font_size = 7;         // Letter height [4:1:14]
raised = 1.2;          // Raised text depth [0.4:0.2:3]

/* [Tag] */
tag_width = 72;        // Tag width [40:1:120]
tag_height = 26;       // Tag height [18:1:45]
thickness = 3;         // Base thickness [1.6:0.2:6]
corner = 4;            // Corner radius [2:1:8]
keyring_hole = true;   // Add a keyring hole
$fn = 40;

module rounded_plate(width, height, depth, radius) {
  hull() {
    for (x = [radius, width - radius])
      for (y = [radius, height - radius])
        translate([x, y, 0]) cylinder(h = depth, r = radius);
  }
}

color("navy")
  difference() {
    rounded_plate(tag_width, tag_height, thickness, corner);
    if (keyring_hole)
      translate([8, tag_height / 2, -1]) cylinder(h = thickness + 2, r = 3);
  }

color("gold")
  translate([keyring_hole ? 15 : 6, tag_height / 2, thickness])
    linear_extrude(height = raised)
      text(label, size = font_size, valign = "center");`,
  },
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
