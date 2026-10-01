extends RefCounted
## Primitive penguin shelves sized from the stocked dolls, so every row fits the tallest design.
## The shop walls and bay pitch are fixed: faces keep the 2.6 m bay width and grow deeper
## (narrowing the aisles) only when two lines of the deepest design need it.
## Each shelf row holds ten slots as a back line of five and a front line of five.
const PENGUIN_SCALE := 2.0
const ROWS := 4
const PER_LINE := 5
const WIDTH := 2.6
const MIN_DEPTH := 0.98
const LINE_GAP := 0.02
const SIDE := 0.06
const BACK := 0.04
const PLANK := 0.04
const BASE := 0.10
const HEADROOM := 0.03
## Collision layer 3 (bit value 4): an invisible front guard that only loose dolls collide with,
## so piles cannot spill into the open rows. Rays for aiming and placement ignore it.
const DOLL_GUARD_LAYER := 4

var max_size := Vector3.ZERO
var row_clear := 0.0
var row_tops: Array[float] = []
var line_z: Array[float] = []
var column_x: Array[float] = []
var height := 0.0
var depth := MIN_DEPTH
var meshes := {}
var shapes := {}
var wood: StandardMaterial3D

## `catalog` is the store's penguin_catalog; product sizes must already include PENGUIN_SCALE.
static func from_catalog(catalog: Array) -> RefCounted:
	var layout = load("res://scripts/3dsortgame/penguin_shelf_layout.gd").new()
	for category in catalog:
		for product in category.get("items", []):
			if not product.has("size"): continue
			var size: Array = product["size"]
			layout.max_size = layout.max_size.max(Vector3(size[0], size[1], size[2]))
	layout.measure()
	return layout

func measure() -> void:
	row_clear = max_size.y + HEADROOM
	row_tops.clear()
	for row in ROWS: row_tops.append(BASE + row * (row_clear + PLANK))
	height = BASE + ROWS * row_clear + ROWS * PLANK
	var inner_width := WIDTH - SIDE * 2.0
	var pitch := inner_width / PER_LINE
	if max_size.x > pitch: push_warning("Penguins are wider (%.2f m) than a shelf column (%.2f m)" % [max_size.x, pitch])
	column_x.clear()
	for column in PER_LINE: column_x.append(-inner_width * 0.5 + pitch * (column + 0.5))
	depth = maxf(MIN_DEPTH, max_size.z * 2.0 + LINE_GAP + BACK)
	var inner_depth := depth - BACK
	var back := -depth * 0.5 + BACK
	line_z = [back + inner_depth * 0.25, back + inner_depth * 0.75]

## Slot `index` 0-9 within a row: 0-4 fill the back line first, 5-9 the front line.
func slot_local(row: int, index: int) -> Vector3:
	return Vector3(column_x[index % PER_LINE], row_tops[row], line_z[index / PER_LINE])

func back_face_z() -> float:
	return -depth * 0.5 + BACK

func front_z() -> float:
	return depth * 0.5

## Distance from a bank's centre line to its shelf fronts (back-to-back faces, 2 cm apart).
func bank_half_width() -> float:
	return depth + 0.01

func build(pivot: Node3D) -> Node3D:
	if wood == null:
		wood = StandardMaterial3D.new()
		wood.albedo_color = Color("9a6a43")
		wood.roughness = 0.85
	var root := Node3D.new()
	root.name = "PrimitiveShelf"
	pivot.add_child(root)
	part(root, "Base", Vector3(0, BASE * 0.5, 0), Vector3(WIDTH, BASE, depth))
	for row in range(1, ROWS):
		part(root, "Plank_%d" % row, Vector3(0, row_tops[row] - PLANK * 0.5, 0), Vector3(WIDTH - SIDE * 2.0, PLANK, depth))
	part(root, "TopCap", Vector3(0, height - PLANK * 0.5, 0), Vector3(WIDTH, PLANK, depth))
	part(root, "BackPanel", Vector3(0, height * 0.5, -depth * 0.5 + BACK * 0.5), Vector3(WIDTH, height, BACK))
	for side in [-1.0, 1.0]:
		part(root, "Side", Vector3(side * (WIDTH - SIDE) * 0.5, height * 0.5, 0), Vector3(SIDE, height, depth))
	var guard := StaticBody3D.new()
	guard.name = "DollGuard"
	guard.collision_layer = DOLL_GUARD_LAYER
	guard.collision_mask = 0
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(WIDTH, height, 0.04)
	collision.shape = shape
	guard.add_child(collision)
	root.add_child(guard)
	guard.position = Vector3(0, height * 0.5, front_z() + 0.02)
	return root

func part(root: Node3D, title: String, center: Vector3, size: Vector3) -> void:
	if not meshes.has(size):
		var mesh := BoxMesh.new()
		mesh.size = size
		meshes[size] = mesh
		var shape := BoxShape3D.new()
		shape.size = size
		shapes[size] = shape
	var node := MeshInstance3D.new()
	node.name = title
	node.mesh = meshes[size]
	node.material_override = wood
	node.position = center
	root.add_child(node)
	var body := StaticBody3D.new()
	body.name = "ShelfSolidGuard"
	var collision := CollisionShape3D.new()
	collision.shape = shapes[size]
	body.add_child(collision)
	node.add_child(body)
