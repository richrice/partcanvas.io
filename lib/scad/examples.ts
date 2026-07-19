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
PHONE_WIDTH = 78;      // Overall phone width [55:1:110]
PHONE_DEPTH = 12;      // Phone + case thickness [7:0.5:22]
LIP_HEIGHT = 14;       // Height of the two retaining tabs [8:1:24]

/* [Stand] */
ANGLE = 68;            // Phone angle measured from horizontal [50:1:82]
BASE_DEPTH = 82;       // Minimum front-to-back footprint [55:1:120]
WALL = 5;              // Base/back thickness [3:0.5:9]
CABLE_SLOT = 14;       // Charging cable channel width [8:1:24]
BACK_LENGTH = 94;      // Length of the inclined back support [75:1:125]
CLEARANCE = 1.5;       // Extra room around phone thickness [0.5:0.5:4]

/* [Hidden] */
stand_width = max(58, PHONE_WIDTH - 4);
front_margin = 8;
lip_thickness = max(4, WALL);
rear_margin = 8;

// Position of the front face of the back support.
back_face_y =
    front_margin +
    lip_thickness +
    PHONE_DEPTH +
    CLEARANCE;

// Shift the angled plate so its front lower edge meets the top
// of the base while its rear edge overlaps the base.
back_origin_y = back_face_y + WALL * sin(ANGLE);
back_origin_z = WALL - WALL * cos(ANGLE);

// Increase the footprint when a shallower viewing angle requires it.
actual_base_depth = max(
    BASE_DEPTH,
    back_origin_y + BACK_LENGTH * cos(ANGLE) + rear_margin
);

lip_tab_width = min(
    22,
    max(14, (stand_width - CABLE_SLOT) / 2 - 2)
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
            [stand_width, actual_base_depth, WALL],
            4
        );

        // Inclined phone support.
        translate([0, back_origin_y, back_origin_z])
            rotate([ANGLE, 0, 0])
                rounded_bar(
                    [stand_width, BACK_LENGTH, WALL],
                    3
                );

        // Reinforcement behind the phone cradle.
        translate([
            0,
            back_face_y + WALL * 0.25,
            WALL
        ])
            rounded_bar(
                [stand_width, WALL * 2.25, WALL * 0.9],
                2
            );

        // Separate tabs retain the phone without covering
        // the entire bottom portion of the screen.
        for (x = [0, stand_width - lip_tab_width])
            translate([x, front_margin, WALL])
                rounded_bar(
                    [
                        lip_tab_width,
                        lip_thickness,
                        LIP_HEIGHT
                    ],
                    min(2, lip_thickness / 2)
                );
    }
}

difference() {
    base_and_cradle();

    // Charging cable channel through the front and phone shelf.
    translate([
        (stand_width - CABLE_SLOT) / 2,
        -0.1,
        -0.1
    ])
        cube([
            CABLE_SLOT,
            back_face_y - 0.8,
            WALL + LIP_HEIGHT + 1
        ]);
}`,
  },
  {
    id: "storage-bin",
    name: "Storage bin",
    description: "A parametric open-top organizer for a desk or workshop.",
    source: `/* [Size] */
WIDTH = 80;       // Outside width [30:1:180]
DEPTH = 60;       // Outside depth [30:1:180]
HEIGHT = 45;      // Overall height [15:1:120]

/* [Construction] */
WALL = 2.4;       // Wall thickness [1.2:0.2:5]
CORNER = 5;       // Corner radius [1:1:15]
FLOOR = 3;        // Bottom thickness [1:0.5:8]
$fn = 40;

module rounded_box(size, radius) {
  hull() {
    for (x = [radius, size[0] - radius])
      for (y = [radius, size[1] - radius])
        translate([x, y, 0]) cylinder(h = size[2], r = radius);
  }
}

difference() {
  rounded_box([WIDTH, DEPTH, HEIGHT], CORNER);
  translate([WALL, WALL, FLOOR])
    rounded_box(
      [WIDTH - 2 * WALL, DEPTH - 2 * WALL, HEIGHT + WALL],
      max(1, CORNER - WALL)
    );
}`,
  },
  {
    id: "calibration",
    name: "Calibration piece",
    description: "A compact primitive and boolean-operation test model.",
    source: `SIZE = 24;       // Body size [10:1:50]
HOLE = 8;        // Through-hole diameter [2:0.5:18]
ROUNDING = 3;    // Corner rounding [1:0.5:6]
$fn = 36;

difference() {
  hull() {
    for (x = [-1, 1])
      for (y = [-1, 1])
        translate([x * (SIZE/2 - ROUNDING), y * (SIZE/2 - ROUNDING), 0])
          cylinder(h = SIZE / 2, r = ROUNDING, center = true);
  }
  cylinder(h = SIZE, d = HOLE, center = true);
}`,
  },
  {
    id: "name-tag",
    name: "Printable name tag",
    description: "Raised custom text on a rounded tag with an optional keyring hole.",
    source: `/* [Label] */
LABEL = "MAKER";       // Text to print
FONT_SIZE = 7;         // Letter height [4:1:14]
RAISED = 1.2;          // Raised text depth [0.4:0.2:3]

/* [Tag] */
TAG_WIDTH = 72;        // Tag width [40:1:120]
TAG_HEIGHT = 26;       // Tag height [18:1:45]
THICKNESS = 3;         // Base thickness [1.6:0.2:6]
CORNER = 4;            // Corner radius [2:1:8]
KEYRING_HOLE = true;   // Add a keyring hole

/* [Colors] */
TAG_COLOR = "navy";    // Base color
TEXT_COLOR = "gold";   // Raised text color
$fn = 40;

module rounded_plate(width, height, depth, radius) {
  hull() {
    for (x = [radius, width - radius])
      for (y = [radius, height - radius])
        translate([x, y, 0]) cylinder(h = depth, r = radius);
  }
}

color(TAG_COLOR)
  difference() {
    rounded_plate(TAG_WIDTH, TAG_HEIGHT, THICKNESS, CORNER);
    if (KEYRING_HOLE)
      translate([8, TAG_HEIGHT / 2, -1]) cylinder(h = THICKNESS + 2, r = 3);
  }

color(TEXT_COLOR)
  translate([KEYRING_HOLE ? 15 : 6, TAG_HEIGHT / 2, THICKNESS])
    linear_extrude(height = RAISED)
      text(LABEL, size = FONT_SIZE, valign = "center");`,
  },
];

export const DEFAULT_SOURCE = EXAMPLES[0].source;
