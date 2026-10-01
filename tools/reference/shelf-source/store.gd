@tool
extends Node3D
## 100 shelf faces × 4 rows × 10 columns = 4,000 individually addressable slots.
const SHELF = preload("res://assets/3dsortgame/shelf.glb")
const ROW_HEIGHTS := [0.105, 0.325, 0.545, 0.755]
const SHELF_SCALE := 2.6
const CAPACITY := 4000
var slots: Array[Transform3D] = []
var occupied: Dictionary = {}
var camera: Camera3D
var fps_label: Label
var fps_elapsed := 0.0
var preview: Node3D
var walking := false
var yaw := 0.0
var pitch := -0.12

func _ready() -> void:
	build_store()
	if Engine.is_editor_hint():
		set_process(false)
		set_process_unhandled_input(false)
		return
	if "--verify-sort-store" in OS.get_cmdline_user_args():
		assert(slots.size() == CAPACITY)
		var unique := {}
		for slot in slots:
			unique[slot.origin] = true
		assert(unique.size() == CAPACITY)
		var item := Node3D.new()
		assert(place_item(0, item))
		var rejected := Node3D.new()
		assert(not place_item(0, rejected))
		rejected.free()
		assert(remove_item(0) == item)
		item.free()
		print("3dsortgame VERIFIED: 100 shelves, 400 rows, 4000 unique slots; placement/removal passed")
		get_tree().quit()
	if "--capture-sort-store" in OS.get_cmdline_user_args():
		await get_tree().process_frame
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("res://tmp/3dsortgame-overview.png")
		camera.position = Vector3(2.8, 2.1, 0)
		camera.look_at(Vector3(0, 1.2, -2.5))
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("res://tmp/3dsortgame-shelves.png")
		get_tree().quit()

func material(color: Color) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.85
	return mat

func tiled_material(base: Color, grout: Color, wall := false) -> StandardMaterial3D:
	var img := Image.create(128, 128, false, Image.FORMAT_RGB8)
	for y in 128:
		for x in 128:
			var seam: bool = y < 2 or (x + (64 if wall and y >= 64 else 0)) % 128 < 2
			if wall:
				seam = y % 64 < 2 or (x + (64 if y >= 64 else 0)) % 128 < 2
			var grain := float((x * 37 + y * 17) % 11) / 1100.0
			img.set_pixel(x, y, grout if seam else base.lightened(grain))
	img.generate_mipmaps()
	var mat := material(base)
	mat.albedo_color = Color.WHITE
	mat.albedo_texture = ImageTexture.create_from_image(img)
	mat.uv1_triplanar = true
	mat.uv1_world_triplanar = true
	mat.uv1_scale = Vector3.ONE * (1.0 if wall else 1.25)
	mat.texture_repeat = true
	return mat

func box(parent: Node3D, title: String, pos: Vector3, size: Vector3, mat: Material, solid := false) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = title
	node.set_meta("store_part", title)
	var mesh := BoxMesh.new()
	mesh.size = size
	node.mesh = mesh
	node.material_override = mat
	parent.add_child(node)
	node.position = pos
	if solid:
		var body := StaticBody3D.new()
		var shape := CollisionShape3D.new()
		var bounds := BoxShape3D.new()
		bounds.size = size
		shape.shape = bounds
		node.add_child(body)
		body.add_child(shape)
	return node

func sign_text(parent: Node3D, caption: String, pos: Vector3, font_size := 64) -> void:
	var label := Label3D.new()
	label.text = caption
	label.font_size = font_size
	label.pixel_size = 0.006
	label.position = pos
	label.modulate = Color("f5f0de")
	parent.add_child(label)

func shelf_scene() -> PackedScene:
	return SHELF

func build_store() -> void:
	var floor_mat := tiled_material(Color("ddd9cb"), Color("aaa89e"))
	var wall_mat := tiled_material(Color("ede5d3"), Color("c9c1af"), true)
	var teal := material(Color("174b4e"))
	var dark := material(Color("25343b"))
	var wood := material(Color("b88651"))
	box(self, "TiledFloor", Vector3(0, -0.15, 0), Vector3(30, 0.3, 40), floor_mat, true)
	box(self, "BackWall", Vector3(0, 2.3, -20), Vector3(30, 4.6, 0.3), wall_mat, true)
	for x in [-15.0, 15.0]:
		box(self, "SideWall", Vector3(x, 2.3, 0), Vector3(0.3, 4.6, 40), wall_mat, true)
		box(self, "WallStripe", Vector3(x * 0.988, 3.1, 0), Vector3(0.035, 0.32, 40), teal)
	box(self, "BackStripe", Vector3(0, 3.1, -19.8), Vector3(30, 0.32, 0.03), teal)
	sign_text(self, "3D SORT / MARKET", Vector3(0, 3.8, -19.75), 130)
	# Open entrance and cutaway ceiling keep the whole store visible from overview.
	for x in [-10.0, 10.0]:
		box(self, "FrontWindowBase", Vector3(x, 0.45, 20), Vector3(10, 0.9, 0.25), teal, true)
		box(self, "EntrancePillar", Vector3(x / 2.0, 2.2, 20), Vector3(0.2, 4.4, 0.3), dark, true)
	preview = Node3D.new()
	preview.name = "CapacityPreview_4000"
	add_child(preview)
	var shelves := Node3D.new()
	shelves.name = "Shelves_100"
	add_child(shelves)
	for bank in 5:
		for bay in 10:
			var z := -15.0 + bay * 2.7 + (2.4 if bay >= 5 else 0.0)
			for side in 2:
				var shelf_id := (bank * 10 + bay) * 2 + side
				var pivot := Node3D.new()
				pivot.name = "Shelf_%03d" % shelf_id
				shelves.add_child(pivot)
				pivot.position = Vector3((bank - 2) * 5.5 + (-0.5 if side == 0 else 0.5), 0, z)
				pivot.rotation.y = -PI / 2.0 if side == 0 else PI / 2.0
				var model := shelf_scene().instantiate() as Node3D
				pivot.add_child(model)
				model.scale = Vector3.ONE * SHELF_SCALE
				# Coarse shelf collision is sufficient until individual item interaction is added.
				var body := StaticBody3D.new()
				var collision := CollisionShape3D.new()
				var shape := BoxShape3D.new()
				shape.size = Vector3(2.6, 2.47, 0.98)
				collision.shape = shape
				collision.position.y = 1.235
				pivot.add_child(body)
				body.add_child(collision)
				for row in 4:
					for column in 10:
						var local := Vector3(-1.08 + column * 0.24, ROW_HEIGHTS[row] * SHELF_SCALE, 0.08)
						slots.append(pivot.transform * Transform3D(Basis.IDENTITY, local))
				if bay == 9:
					box(self, "AisleHeader", Vector3((bank - 2) * 5.5, 3.0, z + 1.45), Vector3(2.5, 0.6, 0.1), teal)
					if side == 0:
						sign_text(self, "AISLE %02d" % (bank + 1), Vector3((bank - 2) * 5.5, 3.0, z + 1.52))
	build_preview()
	for x in [-9.0, -3.0, 3.0, 9.0]:
		box(self, "CheckoutCounter", Vector3(x, 0.52, 17.2), Vector3(3.4, 1.04, 1.3), wood, true)
		box(self, "Conveyor", Vector3(x - 0.4, 1.07, 17.2), Vector3(2.2, 0.08, 1.1), dark)
		box(self, "Register", Vector3(x + 1.15, 1.25, 17.2), Vector3(0.42, 0.3, 0.4), teal)
	for x in [-11.0, -5.5, 0.0, 5.5, 11.0]:
		for z in [-13.0, -4.0, 5.0, 14.0]:
			var light_mat := material(Color("fff4d9"))
			light_mat.emission_enabled = true
			light_mat.emission = Color("fff4d9")
			box(self, "CeilingLight", Vector3(x, 4.4, z), Vector3(0.3, 0.08, 3.0), light_mat)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color("a6bfca")
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color("fff3df")
	env.environment.ambient_light_energy = 0.55
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-65, -25, 0)
	sun.light_energy = 0.7
	sun.shadow_enabled = true
	add_child(sun)
	camera = Camera3D.new()
	add_child(camera)
	camera.far = 150
	set_overview()
	build_hud()

func build_preview() -> void:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.15, 0.29, 0.22)
	var mat := material(Color.WHITE)
	mat.vertex_color_use_as_albedo = true
	mesh.material = mat
	var batch := MultiMesh.new()
	batch.transform_format = MultiMesh.TRANSFORM_3D
	batch.use_colors = true
	batch.mesh = mesh
	batch.instance_count = CAPACITY
	for i in CAPACITY:
		var pose := slots[i]
		pose.origin.y += 0.145
		batch.set_instance_transform(i, pose)
		batch.set_instance_color(i, Color.from_hsv(float((i / 40) % 5) / 5.0, 0.48, 0.82))
	var instance := MultiMeshInstance3D.new()
	instance.multimesh = batch
	preview.add_child(instance)

## Item origins must be at their bottom center; maximum footprint 0.20 × 0.30 m,
## height 0.42 m. IDs: shelf * 40 + row * 10 + column (zero based).
func place_item(slot_id: int, item: Node3D) -> bool:
	if slot_id < 0 or slot_id >= slots.size() or occupied.has(slot_id) or item.get_parent() != null:
		return false
	add_child(item)
	item.transform = slots[slot_id]
	occupied[slot_id] = item
	return true

func remove_item(slot_id: int) -> Node3D:
	var item := occupied.get(slot_id) as Node3D
	if item != null:
		remove_child(item)
		occupied.erase(slot_id)
	return item

func set_overview() -> void:
	walking = false
	if not Engine.is_editor_hint():
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	camera.fov = 45
	camera.position = Vector3(29, 31, 37)
	camera.look_at(Vector3(0, 0, 0))

func build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(24, 24)
	layer.add_child(panel)
	var label := Label.new()
	label.text = "  3DSORTGAME  /  STORE BLOCKOUT  \n  100 shelves · 400 rows · 4,000 item slots  \n  Tab: walk / overview   •   P: preview items  \n  WASD: move   •   Mouse: look   •   Shift: faster   •   Esc: release mouse  "
	label.add_theme_font_size_override("font_size", 20)
	panel.add_child(label)
	var fps_panel := PanelContainer.new()
	fps_panel.position = Vector2(24, 150)
	layer.add_child(fps_panel)
	fps_label = Label.new()
	fps_label.text = "  FPS: --  "
	fps_label.add_theme_font_size_override("font_size", 20)
	fps_panel.add_child(fps_label)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_TAB:
			if walking:
				set_overview()
			else:
				walking = true
				camera.fov = 70
				camera.position = Vector3(2.75, 1.75, 14.5)
				camera.rotation = Vector3(pitch, yaw, 0)
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		if event.keycode == KEY_P:
			preview.visible = not preview.visible
		if event.keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if event is InputEventMouseButton and event.pressed and walking:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseMotion and walking and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * 0.003
		pitch = clampf(pitch - event.relative.y * 0.003, -1.4, 1.4)
		camera.rotation = Vector3(pitch, yaw, 0)

func _process(delta: float) -> void:
	fps_elapsed += delta
	if fps_elapsed >= 0.25:
		fps_elapsed = 0.0
		fps_label.text = "  FPS: %d  " % Engine.get_frames_per_second()
	if not walking:
		return
	var input := Vector3(float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)), 0, float(Input.is_physical_key_pressed(KEY_S)) - float(Input.is_physical_key_pressed(KEY_W)))
	var movement := Basis(Vector3.UP, yaw) * input.normalized() * delta * (9.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 4.0)
	var target := camera.position + movement
	target.x = clampf(target.x, -14.5, 14.5)
	target.z = clampf(target.z, -19.4, 19.4)
	# Floor-plan collision allows sliding along shelf banks and counters.
	if walkable(Vector3(target.x, 0, camera.position.z)):
		camera.position.x = target.x
	if walkable(Vector3(camera.position.x, 0, target.z)):
		camera.position.z = target.z

func walkable(point: Vector3) -> bool:
	for bank in 5:
		if absf(point.x - (bank - 2) * 5.5) < 1.25:
			for bay in 10:
				var z := -15.0 + bay * 2.7 + (2.4 if bay >= 5 else 0.0)
				if absf(point.z - z) < 1.5:
					return false
	for x in [-9.0, -3.0, 3.0, 9.0]:
		if absf(point.x - x) < 1.95 and absf(point.z - 17.2) < 0.9:
			return false
	return true
