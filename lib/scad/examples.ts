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
phone_width = 78;      // Overall phone width [55:1:110]
phone_depth = 12;      // Phone + case thickness [7:0.5:22]
lip_height = 14;       // Height of the two retaining tabs [8:1:24]

/* [Stand] */
angle = 68;            // Phone angle measured from horizontal [50:1:82]
base_depth = 82;       // Minimum front-to-back footprint [55:1:120]
wall = 5;              // Base/back thickness [3:0.5:9]
cable_slot = 14;       // Charging cable channel width [8:1:24]
back_length = 94;      // Length of the inclined back support [75:1:125]
clearance = 1.5;       // Extra room around phone thickness [0.5:0.5:4]

/* [Hidden] */
stand_width = max(58, phone_width - 4);
front_margin = 8;
lip_thickness = max(4, wall);
rear_margin = 8;

// Position of the front face of the back support.
back_face_y =
    front_margin +
    lip_thickness +
    phone_depth +
    clearance;

// Shift the angled plate so its front lower edge meets the top
// of the base while its rear edge overlaps the base.
back_origin_y = back_face_y + wall * sin(angle);
back_origin_z = wall - wall * cos(angle);

// Increase the footprint when a shallower viewing angle requires it.
actual_base_depth = max(
    base_depth,
    back_origin_y + back_length * cos(angle) + rear_margin
);

lip_tab_width = min(
    22,
    max(14, (stand_width - cable_slot) / 2 - 2)
);

$fn = 64;

module rounded_bar(size, radius = 3) {
    r = min(radius, min(size[0], size[1]) / 2);

    hull() {
        for (x = [r, size[0] - r])
            for (y = [r, size[1] - r])
                translate([x, y, 0])
                    cylinder(h = size[2], r = r);
    }
}

module base_and_cradle() {
    union() {
        // Stable base and phone shelf.
        rounded_bar(
            [stand_width, actual_base_depth, wall],
            4
        );

        // Inclined phone support.
        translate([0, back_origin_y, back_origin_z])
            rotate([angle, 0, 0])
                rounded_bar(
                    [stand_width, back_length, wall],
                    3
                );

        // Reinforcement behind the phone cradle.
        translate([
            0,
            back_face_y + wall * 0.25,
            wall
        ])
            rounded_bar(
                [stand_width, wall * 2.25, wall * 0.9],
                2
            );

        // Separate tabs retain the phone without covering
        // the entire bottom portion of the screen.
        for (x = [0, stand_width - lip_tab_width])
            translate([x, front_margin, wall])
                rounded_bar(
                    [
                        lip_tab_width,
                        lip_thickness,
                        lip_height
                    ],
                    min(2, lip_thickness / 2)
                );
    }
}

difference() {
    base_and_cradle();

    // Charging cable channel through the front and phone shelf.
    translate([
        (stand_width - cable_slot) / 2,
        -0.1,
        -0.1
    ])
        cube([
            cable_slot,
            back_face_y - 0.8,
            wall + lip_height + 1
        ]);
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

/* [Colors] */
tag_color = "navy";    // Base color
text_color = "gold";   // Raised text color
$fn = 40;

module rounded_plate(width, height, depth, radius) {
  hull() {
    for (x = [radius, width - radius])
      for (y = [radius, height - radius])
        translate([x, y, 0]) cylinder(h = depth, r = radius);
  }
}

color(tag_color)
  difference() {
    rounded_plate(tag_width, tag_height, thickness, corner);
    if (keyring_hole)
      translate([8, tag_height / 2, -1]) cylinder(h = thickness + 2, r = 3);
  }

color(text_color)
  translate([keyring_hole ? 15 : 6, tag_height / 2, thickness])
    linear_extrude(height = raised)
      text(label, size = font_size, valign = "center");`,
  },
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
