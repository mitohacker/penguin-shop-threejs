@tool
extends "res://scripts/3dsortgame/store.gd"
## Independent penguin doll inventory; shares the original store architecture and FPS controls.
var penguin_catalog: Array = []
var stock_by_slot: Dictionary = {}
var unique_products := 0
var floor_items: Dictionary = {}
var floor_poses: Array[Transform3D] = []
var falling_batches: Array[Dictionary] = []
var drop_elapsed := 0.0
var touch_controls: Control
var session: Node
var shelf_layout: RefCounted
## Walking stands on the floor pile: eye height above the highest doll under the player.
const EYE_HEIGHT := 1.75
const FOOT_RADIUS := 0.2
const CLIMB_SPEED := 4.0
const FALL_SPEED := 6.0
const ShelfLayout = preload("res://scripts/3dsortgame/penguin_shelf_layout.gd")

func shelf_scene() -> PackedScene:
	# Shelves are primitives sized from the penguins in build_primitive_shelves().
	var scene := PackedScene.new()
	scene.pack(Node3D.new())
	return scene

func build_primitive_shelves() -> void:
	slots.clear()
	for shelf in get_node("Shelves_100").get_children():
		for child in shelf.get_children():
			child.free()
		# Deeper faces stay back to back on the bank centre line.
		var bank := roundi(shelf.position.x / 5.5)
		shelf.position.x = bank * 5.5 + signf(shelf.position.x - bank * 5.5) * (shelf_layout.depth * 0.5 + 0.01)
		shelf_layout.build(shelf)
		for row in 4:
			for index in 10:
				slots.append(shelf.transform * Transform3D(Basis.IDENTITY, shelf_layout.slot_local(row, index)))

func build_store() -> void:
	if not Engine.is_editor_hint():
		# Final-pass AA also smooths the transparent ink overlay; MSAA alone cannot.
		preload("res://scripts/3dsortgame/penguin_video.gd").new().apply_antialiasing(get_viewport())
		Engine.max_fps = 0
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	super.build_store()
	build_primitive_shelves()
	var decor = load("res://scripts/3dsortgame/penguin_environment.gd").new()
	decor.name = "HarborEnvironment"
	add_child(decor)
	decor.setup(self)
	for child in get_children():
		if child is Label3D and child.text == "3D SORT / MARKET":
			child.text = "PENGUIN / DOLL SHOP"
			child.font_size = 105
	var shelves := get_node("Shelves_100")
	for shelf in shelves.get_children():
		var shelf_id := int(String(shelf.name).trim_prefix("Shelf_"))
		var category: Dictionary = penguin_catalog[mini(shelf_id * penguin_catalog.size() / 100, penguin_catalog.size() - 1)]
		var title := String(category["title"]).split("(")[0].strip_edges()
		var sign_y: float = shelf_layout.height + 0.2
		var sign_z: float = shelf_layout.front_z() - 0.07
		box(shelf, "DepartmentSign", Vector3(0, sign_y, sign_z), Vector3(2.45, 0.23, 0.04), material(Color("205560")))
		sign_text(shelf, title.to_upper(), Vector3(0, sign_y, sign_z + 0.03), 20)
	if not Engine.is_editor_hint():
		DisplayServer.window_set_title("Penguin Shop Sort")
		var interaction = load("res://scripts/3dsortgame/penguin_interaction.gd").new()
		interaction.name = "PenguinInteraction"
		add_child(interaction)
		interaction.setup(self)
		build_row_thumbnails()
		if not get_meta("style_editor", false) and not "--verify-penguin-store" in OS.get_cmdline_user_args() and not "--capture-penguin-store" in OS.get_cmdline_user_args() and OS.get_cmdline_args().find("--script") < 0:
			start_session(interaction)
	if not Engine.is_editor_hint():
		var style = load("res://scripts/3dsortgame/penguin_style.gd").new()
		style.name = "PenguinStyle"
		add_child(style)
		style.setup(self, get_meta("style_path", "user://penguin_style.cfg"))
		if preload("res://scripts/3dsortgame/penguin_android.gd").enabled():
			# Avoid redrawing all 4,000 dolls into directional shadow maps on phones.
			for light in find_children("*", "Light3D", true, false):
				light.shadow_enabled = false
		else:
			# Doll batches span a store quadrant, so every cascade redraws most of the pile.
			# Two short cascades keep shadows within reach at a fraction of the cost.
			for light in find_children("*", "DirectionalLight3D", true, false):
				light.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
				light.directional_shadow_max_distance = 24.0
	if "--verify-penguin-store" in OS.get_cmdline_user_args():
		assert(slots.size() == 4000)
		var expected_products := 0
		for category in penguin_catalog:
			expected_products += category["items"].size()
		assert(unique_products == expected_products, "Not all source-sheet products are stocked")
		assert(stock_by_slot.is_empty(), "Shelves must start empty")
		assert(floor_items.size() == 4000 and floor_poses.size() == 4000)
		var positions := {}
		for pose in floor_poses:
			assert(pose.origin.is_finite())
			positions[pose.origin] = true
		assert(positions.size() == 4000)
		print("PENGUIN VERIFIED: %d products / 4000 floor items / 4000 empty shelf slots" % unique_products)
		get_tree().quit()
	if "--capture-penguin-store" in OS.get_cmdline_user_args():
		capture_penguin.call_deferred()

func build_preview() -> void:
	unique_products = 0
	stock_by_slot.clear()
	floor_items.clear()
	falling_batches.clear()
	drop_elapsed = 0.0
	var manifest = JSON.parse_string(FileAccess.get_file_as_string("res://assets/penguin_sort/source_manifest.json"))
	penguin_catalog = manifest["sheets"]
	var batches: Dictionary = {}
	for category in penguin_catalog:
		var path := "res://assets/penguin_sort/%s/catalog.json" % category["id"]
		if FileAccess.file_exists(path):
			var generated = JSON.parse_string(FileAccess.get_file_as_string(path))
			category["items"] = generated["items"]
			for product in category["items"]:
				var size: Array = product["size"]
				product["size"] = [size[0] * ShelfLayout.PENGUIN_SCALE, size[1] * ShelfLayout.PENGUIN_SCALE, size[2] * ShelfLayout.PENGUIN_SCALE]
			unique_products += generated["items"].size()
	shelf_layout = ShelfLayout.from_catalog(penguin_catalog)
	build_floor_poses()
	for shelf_id in 100:
		var category: Dictionary = penguin_catalog[mini(shelf_id * penguin_catalog.size() / 100, penguin_catalog.size() - 1)]
		for row in 4:
			for col in 10:
				var product: Dictionary = category["items"][(shelf_id % 10 * 4 + row) % category["items"].size()]
				if not product.has("scene"):
					continue
				var slot_id := shelf_id * 40 + row * 10 + col
				if not batches.has(product["id"]):
					batches[product["id"]] = {"product": product, "slots": []}
				batches[product["id"]]["slots"].append(slot_id)
	for batch in batches.values():
		var scene := load(batch["product"]["scene"]) as PackedScene
		if scene == null:
			push_error("Missing penguin product: " + str(batch["product"]["scene"]))
			continue
		var prototype := scene.instantiate() as Node3D
		add_product_meshes(prototype, Transform3D(Basis.from_scale(Vector3.ONE * ShelfLayout.PENGUIN_SCALE), Vector3.ZERO), batch)
		prototype.free()
		for slot_id in batch["slots"]:
			floor_items[slot_id] = batch["product"]["id"]

func is_floor_space(point: Vector3) -> bool:
	# Keep dolls clear of shelf footprints, walls, and checkout counters.
	for bank in 5:
		if absf(point.x - (bank - 2) * 5.5) < shelf_layout.bank_half_width() + 0.24 and point.z > -16.55 and point.z < 13.25:
			return false
	for counter_x in [-9.0, -3.0, 3.0, 9.0]:
		if absf(point.x - counter_x) < 1.95 and absf(point.z - 17.2) < 0.9:
			return false
	return absf(point.x) < 14.6 and absf(point.z) < 19.5

func build_floor_poses() -> void:
	floor_poses.clear()
	var candidates: Array[Vector3] = []
	var rng := RandomNumberGenerator.new()
	rng.seed = 20260912
	for z in 97:
		for x in 73:
			var point := Vector3(-14.4 + x * 0.4, 0.005, -19.2 + z * 0.4)
			point.x += rng.randf_range(-0.01, 0.01)
			point.z += rng.randf_range(-0.01, 0.01)
			if is_floor_space(point):
				candidates.append(point)
	assert(candidates.size() >= CAPACITY, "Insufficient clear floor positions")
	for i in range(candidates.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var point := candidates[i]
		candidates[i] = candidates[j]
		candidates[j] = point
	for i in CAPACITY:
		floor_poses.append(Transform3D(Basis(Vector3.UP, rng.randf_range(-PI, PI)), candidates[i]))

func add_product_meshes(node: Node3D, parent_transform: Transform3D, batch: Dictionary) -> void:
	var pose := parent_transform * node.transform
	if node is MeshInstance3D:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = node.mesh
		mm.instance_count = batch["slots"].size()
		for i in mm.instance_count:
			var target: Transform3D = floor_poses[batch["slots"][i]] * pose
			if not Engine.is_editor_hint():
				target.origin.y += 1.2 + float(int(batch["slots"][i]) % 17) * 0.09
			mm.set_instance_transform(i, target)
		var display := MultiMeshInstance3D.new()
		display.name = batch["product"]["id"]
		display.multimesh = mm
		display.material_override = node.material_override
		preview.add_child(display)
		falling_batches.append({"mesh": mm, "ids": batch["slots"], "pose": pose})
	for child in node.get_children():
		if child is Node3D:
			add_product_meshes(child, pose, batch)

func build_hud() -> void:
	super.build_hud()
	fps_label.get_parent().visible = get_meta("style_editor", false) or "--penguin-editor-launch" in OS.get_cmdline_user_args()
	for node in find_children("*", "Label", true, false):
		if node == fps_label:
			continue
		node.text = "  PENGUIN SHOP SORT  \n  %d product types / %d penguins on floor / 4,000 empty shelf slots  \n  Tab: walk / overview   â€¢   P: show / hide stock  \n  WASD: move   â€¢   Mouse: look   â€¢   Shift: faster   â€¢   Esc: release mouse  " % [unique_products, floor_items.size()]

## True over a shelf face's footprint (inside its rows or on its top). O(1) bank/bay lookup.
func over_shelf(point: Vector3) -> bool:
	var bank := roundi(point.x / 5.5)
	if absi(bank) > 2 or absf(point.x - bank * 5.5) >= shelf_layout.bank_half_width(): return false
	# Bays 0-4 start at z=-15, bays 5-9 at z=0.9 (after the cross aisle); pitch 2.7 m.
	var bay := roundi((point.z + 15.0) / 2.7) if point.z < -1.65 else 5 + roundi((point.z - 0.9) / 2.7)
	if bay < 0 or bay > 9: return false
	var bay_z := -15.0 + bay * 2.7 + (2.4 if bay >= 5 else 0.0)
	return absf(point.z - bay_z) < ShelfLayout.WIDTH * 0.5

func walkable(point: Vector3) -> bool:
	for bank in 5:
		if absf(point.x - (bank - 2) * 5.5) < shelf_layout.bank_half_width() + 0.26:
			for bay in 10:
				var z := -15.0 + bay * 2.7 + (2.4 if bay >= 5 else 0.0)
				if absf(point.z - z) < 1.5:
					return false
	for x in [-9.0, -3.0, 3.0, 9.0]:
		if absf(point.x - x) < 1.95 and absf(point.z - 17.2) < 0.9:
			return false
	return true

func _unhandled_input(event: InputEvent) -> void:
	if touch_controls != null and event is InputEventMouse and event.device == InputEvent.DEVICE_ID_EMULATION: return
	if session != null and session.is_menu_open(): return
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_F8:
		if session != null:
			session.toggle_vsync()
			return
		var enabled := DisplayServer.window_get_vsync_mode() != DisplayServer.VSYNC_DISABLED
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED if enabled else DisplayServer.VSYNC_ENABLED)
		return
	super._unhandled_input(event)

func _process(delta: float) -> void:
	if session == null:
		super._process(delta)
	else:
		fps_elapsed += delta
		if fps_elapsed >= 0.25: fps_elapsed = 0.0
		if not session.is_menu_open() and walking:
			var b = session.bindings
			var input := Vector3(float(b.held("right")) - float(b.held("left")), 0, float(b.held("down")) - float(b.held("up")))
			if touch_controls != null:
				input += Vector3(touch_controls.movement.x, 0, touch_controls.movement.y)
			var speed: float = 4.0 * (session._room.upgrades.speed_multiplier() if b.held("fast") else 1.0)
			var target := camera.position + Basis(Vector3.UP, yaw) * input.normalized() * delta * speed
			target.x = clampf(target.x, -14.5, 14.5); target.z = clampf(target.z, -19.4, 19.4)
			if walkable(Vector3(target.x, 0, camera.position.z)): camera.position.x = target.x
			if walkable(Vector3(camera.position.x, 0, target.z)): camera.position.z = target.z
			follow_pile(delta)
	if fps_label != null and fps_elapsed == 0.0:
		var enabled := DisplayServer.window_get_vsync_mode() != DisplayServer.VSYNC_DISABLED
		fps_label.text = "  FPS: %d  |  VSync: %s (F8)  " % [Engine.get_frames_per_second(), "ON" if enabled else "OFF"]

func follow_pile(delta: float) -> void:
	var ground: float = session.control.pile_height.height_at(camera.position, FOOT_RADIUS)
	var eye := EYE_HEIGHT + ground
	camera.position.y = move_toward(camera.position.y, eye, delta * (CLIMB_SPEED if eye > camera.position.y else FALL_SPEED))

func capture_penguin() -> void:
	await get_tree().create_timer(2.0).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://tmp/penguin-sort/store-overview.png")
	camera.fov = 65
	camera.position = Vector3(-8.1, 1.7, -13.0)
	camera.look_at(Vector3(-10.5, 1.2, -14.0))
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://tmp/penguin-sort/store-closeup.png")
	for category_index in penguin_catalog.size():
		var shelf_id := ceili(float(category_index) * 100.0 / penguin_catalog.size())
		var pose := slots[shelf_id * 40 + 24]
		camera.position = pose.origin + pose.basis.z * 2.4 + Vector3.UP * 0.6
		camera.look_at(pose.origin)
		await get_tree().create_timer(1.0).timeout
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("res://tmp/penguin-sort/store-%s.png" % penguin_catalog[category_index]["id"])
	print("PENGUIN FPS: ", Engine.get_frames_per_second(), " VSync=", DisplayServer.window_get_vsync_mode(), " max_fps=", Engine.max_fps)
	var toggle := InputEventKey.new()
	toggle.keycode = KEY_F8
	toggle.pressed = true
	_unhandled_input(toggle)
	assert(DisplayServer.window_get_vsync_mode() == DisplayServer.VSYNC_ENABLED)
	_unhandled_input(toggle)
	assert(DisplayServer.window_get_vsync_mode() == DisplayServer.VSYNC_DISABLED)
	print("PENGUIN F8 VSync toggle verified")
	get_tree().quit()


func start_session(interaction: Node) -> void:
	session = load("res://scripts/3dsortgame/penguin_session.gd").new()
	session.name = "PenguinSession"
	session.shop = self
	session.control = interaction
	interaction.session = session
	var room = load("res://scripts/3dsortgame/penguin_room.gd").new()
	room.name = "Room"
	session.add_child(room)
	room.setup(self, interaction)
	var dummy := Camera2D.new()
	dummy.name = "Camera2D"
	dummy.enabled = false
	session.add_child(dummy)
	for label in find_children("*", "Label", true, false):
		if label != fps_label and label.name not in ["Crosshair", "TargetCaption"]: label.hide()
	interaction.hint.show()
	interaction.target_label.show()
	add_child(session)
	if preload("res://scripts/3dsortgame/penguin_android.gd").enabled():
		var layer := CanvasLayer.new()
		layer.layer = 9
		add_child(layer)
		touch_controls = preload("res://scripts/3dsortgame/penguin_android.gd").new()
		touch_controls.shop = self
		layer.add_child(touch_controls)

func build_row_thumbnails() -> void:
	var frame_mesh := thumbnail_frame_mesh()
	var interaction = get_node("PenguinInteraction")
	for shelf in get_node("Shelves_100").get_children():
		var shelf_id := int(String(shelf.name).trim_prefix("Shelf_"))
		for row in 4:
			var slot_id := shelf_id * 40 + row * 10
			var guide := MeshInstance3D.new()
			guide.name = "RowThumbnail_%d" % row
			guide.set_meta("skip_store_style", true)
			guide.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			var quad := QuadMesh.new()
			quad.size = Vector2(0.32, 0.32)
			guide.mesh = quad
			var mat := StandardMaterial3D.new()
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			mat.albedo_texture = preload("res://scripts/3dsortgame/penguin_thumbnails.gd").texture_for(interaction.expected[slot_id])
			mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
			guide.material_override = mat
			var frame := MeshInstance3D.new()
			frame.name = "ThumbnailWoodFrame"
			frame.mesh = frame_mesh
			frame.set_meta("skip_store_style", true)
			frame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			guide.add_child(frame)
			if preload("res://scripts/3dsortgame/penguin_android.gd").enabled():
				# These small row cards are only useful within the five-metre pickup range.
				guide.visibility_range_end = 10.0
				frame.visibility_range_end = 10.0
			shelf.add_child(guide)
			# Sit 1 cm in front of the back panel, high in the row, behind the stocked penguins.
			# Local +Z faces the aisle on both sides of each rotated shelf bank.
			guide.position = Vector3(0, shelf_layout.row_tops[row] + shelf_layout.row_clear - 0.2, shelf_layout.back_face_z() + 0.01)

func thumbnail_frame_mesh() -> ArrayMesh:
	# One shared, bevelled walnut frame mesh; its open center leaves the image clear.
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sizes := [0.181, 0.177, 0.163, 0.158]
	var depths := [0.001, 0.007, 0.007, 0.002]
	var colors := [Color("251b16"), Color("765036"), Color("533723"), Color("211915")]
	var corners := [Vector2(-1,-1), Vector2(1,-1), Vector2(1,1), Vector2(-1,1)]
	for ring in 3:
		for side in 4:
			var next := (side + 1) % 4
			for vertex in [[ring,side],[ring,next],[ring+1,next],[ring,side],[ring+1,next],[ring+1,side]]:
				var point: Vector2 = corners[vertex[1]] * sizes[vertex[0]]
				surface.set_color(colors[vertex[0]])
				surface.add_vertex(Vector3(point.x, point.y, depths[vertex[0]]))
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	surface.set_material(mat)
	return surface.commit()
