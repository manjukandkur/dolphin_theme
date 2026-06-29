import frappe


def resolve_bi(doc, method=None):
	"""Before validate on Buyer Inspection.

	Keeps the import sheet simple: the user supplies a Consignee COMPANY NAME and
	a BLOCK NUMBER; we resolve them to the stored links and auto-fill L/W/H, Size
	and Specific Gravity from current stock (only when blank, so manual overrides
	are respected).
	"""
	try:
		eb = doc.get("export_buyer")
		if eb and not frappe.db.exists("Export Consignee", eb):
			code = frappe.db.get_value("Export Consignee", {"company_name": eb}, "name")
			if code:
				doc.export_buyer = code
	except Exception:
		frappe.log_error(frappe.get_traceback(), "resolve_bi: consignee")

	for row in (doc.get("block_rows") or []):
		try:
			name = row.get("block")
			num = (row.get("block_number_input") or "").strip()
			# If the block link holds something that is not a real block name,
			# treat it as a block NUMBER instead.
			if name and not frappe.db.exists("Quarry Block", name):
				num = num or str(name).strip()
				name = None
				row.block = None
			if not name and num:
				resolved = frappe.db.get_value("Quarry Block", {"block_number": num}, "name")
				if resolved:
					row.block = resolved
					if not row.get("block_number_input"):
						row.block_number_input = num
			if row.get("block"):
				b = frappe.db.get_value(
					"Quarry Block",
					row.block,
					["length_gross", "width_gross", "height_gross", "granite_size_category", "pit"],
					as_dict=True,
				)
				if b:
					if not row.get("length_gross"):
						row.length_gross = b.get("length_gross")
					if not row.get("width_gross"):
						row.width_gross = b.get("width_gross")
					if not row.get("height_gross"):
						row.height_gross = b.get("height_gross")
					if not row.get("granite_size_category"):
						row.granite_size_category = b.get("granite_size_category")
					if not row.get("specific_gravity") and b.get("pit"):
						row.specific_gravity = (
							frappe.db.get_value("Pit", b.get("pit"), "specific_gravity") or 2.6
						)
		except Exception:
			frappe.log_error(frappe.get_traceback(), "resolve_bi: block row")


def backref_blocks(doc, method=None):
	"""After save: stamp each block with its Source Buyer Inspection back-reference."""
	for row in (doc.get("block_rows") or []):
		try:
			blk = row.get("block")
			if blk and frappe.db.exists("Quarry Block", blk):
				if frappe.db.get_value("Quarry Block", blk, "source_buyer_inspection") != doc.name:
					frappe.db.set_value(
						"Quarry Block", blk, "source_buyer_inspection", doc.name,
						update_modified=False,
					)
		except Exception:
			frappe.log_error(frappe.get_traceback(), "backref_blocks")
