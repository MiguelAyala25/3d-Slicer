"""
test_exporter.py — Suite de pruebas para la Fase 2 (Exportación DXF y SVG).
"""

import sys
import os

# Configurar encoding UTF-8 en Windows si es posible
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import numpy as np
import trimesh
import ezdxf
from shapely.geometry import Polygon

from slicer import slice_mesh, SliceResult
from exporter import export_dxf, export_svg


def run_tests():
    print("=" * 60)
    print("EJECUTANDO PRUEBAS DE FASE 2 -- Exportación DXF y SVG")
    print("=" * 60)

    # ---------------------------------------------------------
    # 1. Pruebas de validación de entradas inválidas
    # ---------------------------------------------------------
    print("\n[1] Probando validación de entradas inválidas...")
    ok, msg = export_dxf(None, "dummy.dxf")
    assert not ok and "inválido" in msg, f"Fallo en result=None (DXF): {msg}"

    ok, msg = export_svg(None, "dummy.svg")
    assert not ok and "inválido" in msg, f"Fallo en result=None (SVG): {msg}"

    empty_res = SliceResult(
        polygons=[None, None],
        empty_plates=[0, 1],
        original_bounds=(0, 10),
        assembled_height=10.0,
        auto_scale=1.0,
        warnings=["Vacio"]
    )
    ok, msg = export_dxf(empty_res, "dummy.dxf")
    assert not ok and "No hay placas válidas" in msg, f"Fallo en placas vacias (DXF): {msg}"

    ok, msg = export_svg(empty_res, "dummy.svg")
    assert not ok and "No hay placas válidas" in msg, f"Fallo en placas vacias (SVG): {msg}"

    ok, msg = export_dxf(empty_res, "")
    assert not ok, "Fallo en output_path vacio (DXF)"

    ok, msg = export_svg(empty_res, "")
    assert not ok, "Fallo en output_path vacio (SVG)"
    print("[OK] Validación de entradas inválidas pasó con éxito.")

    # ---------------------------------------------------------
    # 2. Pruebas de exportación con Cubo
    # ---------------------------------------------------------
    print("\n[2] Probando exportación con Cubo (5 placas)...")
    box = trimesh.creation.box(extents=[20, 20, 20])
    res_box = slice_mesh(box, plates=5, gap=2.0, thickness=3.0, axis='z')

    dxf_box_path = "tmp_test_box.dxf"
    svg_box_path = "tmp_test_box.svg"

    ok, path = export_dxf(res_box, dxf_box_path, add_alignment_marks=True)
    assert ok and os.path.exists(dxf_box_path), f"Fallo exportando DXF cubo: {path}"

    ok, path = export_svg(res_box, svg_box_path, margin_mm=10.0, add_alignment_marks=True)
    assert ok and os.path.exists(svg_box_path), f"Fallo exportando SVG cubo: {path}"

    # Inspeccionar DXF de cubo
    doc = ezdxf.readfile(dxf_box_path)
    msp = doc.modelspace()
    layer_names = [l.dxf.name for l in doc.layers]
    for i in range(1, 6):
        assert f"PLACA_{i:02d}" in layer_names, f"Falta capa PLACA_{i:02d} en DXF"
    assert "ALINEACION" in layer_names, "Falta capa ALINEACION en DXF"

    # Verificar cantidad de polilíneas y círculos
    polylines = list(msp.query('LWPOLYLINE'))
    assert len(polylines) == 5, f"Esperadas 5 polilineas en DXF, obtenidas {len(polylines)}"
    circles = list(msp.query('CIRCLE[layer=="ALINEACION"]'))
    assert len(circles) == 10, f"Esperados 10 circulos de alineacion (2 por placa), obtenidos {len(circles)}"

    # Inspeccionar SVG de cubo
    with open(svg_box_path, "r", encoding="utf-8") as f:
        svg_content = f.read()
    assert "fill-rule:evenodd" in svg_content, "SVG debe tener fill-rule:evenodd"
    assert "alignment-marks" in svg_content, "SVG debe tener grupo de marcas de alineacion"
    assert svg_content.count("<circle") == 10, "SVG debe contener 10 circulos de alineacion"

    print("[OK] Cubo exportado y verificado correctamente en DXF y SVG.")

    # ---------------------------------------------------------
    # 3. Pruebas con Torus (modelo con huecos / interiores)
    # ---------------------------------------------------------
    print("\n[3] Probando exportación con Torus (huecos interiores)...")
    torus = trimesh.creation.torus(major_radius=20, minor_radius=8)
    res_torus = slice_mesh(torus, plates=7, gap=1.0, thickness=2.0, axis='z')

    dxf_torus_path = "tmp_test_torus.dxf"
    svg_torus_path = "tmp_test_torus.svg"

    ok, _ = export_dxf(res_torus, dxf_torus_path)
    assert ok and os.path.exists(dxf_torus_path)

    ok, _ = export_svg(res_torus, svg_torus_path)
    assert ok and os.path.exists(svg_torus_path)

    doc_t = ezdxf.readfile(dxf_torus_path)
    msp_t = doc_t.modelspace()

    # En el plano medio del toroide debe haber 2 polilíneas en la misma capa (exterior + interior)
    layer_poly_counts = {}
    for p in msp_t.query('LWPOLYLINE'):
        layer_poly_counts[p.dxf.layer] = layer_poly_counts.get(p.dxf.layer, 0) + 1

    has_hole_plate = any(count >= 2 for count in layer_poly_counts.values())
    assert has_hole_plate, f"El DXF del toroide debe contener capas con contornos interiores (huecos): {layer_poly_counts}"

    # En SVG, el path del toroide con hueco debe contener múltiples comandos 'M'
    with open(svg_torus_path, "r", encoding="utf-8") as f:
        svg_torus_content = f.read()

    # Buscar líneas de path con múltiples M
    found_subpath = False
    for line in svg_torus_content.splitlines():
        if '<path d="' in line and line.count("M ") >= 2:
            found_subpath = True
            break
    assert found_subpath, "El SVG del toroide debe tener al menos un path con multiples contornos M (exterior + hueco)"
    print("[OK] Torus: contornos interiores y huecos exportados correctamente.")

    # ---------------------------------------------------------
    # 4. Pruebas de Bounding Box Global y Posición Relativa (L-block)
    # ---------------------------------------------------------
    print("\n[4] Probando Bounding Box Global y preservación de posición relativa (L-block)...")
    if not os.path.exists("test_l_block.obj"):
        import trimesh.transformations as tx
        l_poly = Polygon([(0, 0), (30, 0), (30, 10), (10, 10), (10, 30), (0, 30)])
        l_mesh_gen = trimesh.creation.extrude_polygon(l_poly, height=15)
        l_mesh_gen.apply_transform(tx.rotation_matrix(np.pi / 2, [1, 0, 0]))
        l_mesh_gen.export("test_l_block.obj")

    l_mesh = trimesh.load("test_l_block.obj", force='mesh')
    res_l = slice_mesh(l_mesh, plates=5, gap=2.0, thickness=3.0, axis='z')

    dxf_l_path = "tmp_test_l.dxf"
    svg_l_path = "tmp_test_l.svg"

    ok, _ = export_dxf(res_l, dxf_l_path, add_alignment_marks=True, margin_mm=10.0)
    assert ok

    ok, _ = export_svg(res_l, svg_l_path, margin_mm=10.0, add_alignment_marks=True)
    assert ok

    doc_l = ezdxf.readfile(dxf_l_path)
    msp_l = doc_l.modelspace()

    # Obtener polilíneas de la placa 1 (base ancha) y placa 5 (columna estrecha)
    p1_lines = list(msp_l.query('LWPOLYLINE[layer=="PLACA_01"]'))
    p5_lines = list(msp_l.query('LWPOLYLINE[layer=="PLACA_05"]'))
    assert len(p1_lines) > 0 and len(p5_lines) > 0

    p1_pts = np.array(p1_lines[0].get_points('xy'))
    p5_pts = np.array(p5_lines[0].get_points('xy'))

    # Calcular posiciones relativas dentro del slot
    # x_offset de la placa 1 es 10.0
    # x_offset de la placa 5 es 10 + 4 * (slot_width + 10)
    # Para verificar que no están autocentradas individualmente:
    # La placa 1 y la placa 5 deben tener desplazamientos relativos distintos que reflejan la L original
    p1_min_x = np.min(p1_pts[:, 0])
    p5_min_x = np.min(p5_pts[:, 0])

    # Slot width = global_max_x - global_min_x
    valid_plates = [plist for plist in res_l.polygons if plist is not None]
    g_min_x = min(min(p.bounds[0] for p in plist) for plist in valid_plates)
    g_max_x = max(max(p.bounds[2] for p in plist) for plist in valid_plates)
    slot_w = g_max_x - g_min_x

    margin = 10.0
    slot1_x_offset = margin
    slot5_x_offset = margin + 4 * (slot_w + margin)

    rel_p1_x = p1_min_x - slot1_x_offset
    rel_p5_x = p5_min_x - slot5_x_offset

    # En el L-block centrado, la base (placa 1) empieza en el borde izquierdo global (rel_p1_x ~ 0)
    # mientras que la columna (placa 5) empieza desplazada o tiene ancho diferente
    p1_w = np.max(p1_pts[:, 0]) - np.min(p1_pts[:, 0])
    p5_w = np.max(p5_pts[:, 0]) - np.min(p5_pts[:, 0])
    assert abs(p1_w - p5_w) > 2.0, f"Las placas deben conservar anchos asimétricos distintos: {p1_w} vs {p5_w}"
    print(f"[OK] Anchos relativos preservados: placa 1={p1_w:.2f}mm, placa 5={p5_w:.2f}mm")

    # Verificar marcas de alineación en cada slot
    circles_l = list(msp_l.query('CIRCLE[layer=="ALINEACION"]'))
    assert len(circles_l) == 10, f"Esperados 10 circulos, obtenidos {len(circles_l)}"

    # Verificar que las marcas están en la misma posición relativa en todos los slots
    for slot_idx in range(5):
        slot_x_off = margin + slot_idx * (slot_w + margin)
        slot_circles = [
            c for c in circles_l
            if slot_x_off <= c.dxf.center.x <= slot_x_off + slot_w
        ]
        assert len(slot_circles) == 2, f"Slot {slot_idx} debe tener 2 circulos, tiene {len(slot_circles)}"

        # Ordenar por x
        slot_circles.sort(key=lambda c: c.dxf.center.x)
        c_a = slot_circles[0]
        c_b = slot_circles[1]

        rel_ax = c_a.dxf.center.x - slot_x_off
        rel_bx = c_b.dxf.center.x - slot_x_off

        assert abs(rel_ax - slot_w * 0.25) < 1e-3, f"Pin A no está en 25% del slot: {rel_ax} vs {slot_w * 0.25}"
        assert abs(rel_bx - slot_w * 0.75) < 1e-3, f"Pin B no está en 75% del slot: {rel_bx} vs {slot_w * 0.75}"
        assert abs(c_a.dxf.center.y - c_b.dxf.center.y) > 1.0, "Pin A y Pin B deben tener alturas distintas para fijar orientación"

    print("[OK] Bounding box global y marcas de alineación consistentes en todos los slots.")

    # ---------------------------------------------------------
    # 5. Pruebas de MultiPolygon (múltiples partes en una placa)
    # ---------------------------------------------------------
    print("\n[5] Probando placas con múltiples polígonos desconectados...")
    p_a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    p_b = Polygon([(20, 0), (30, 0), (30, 10), (20, 10)])
    multi_res = SliceResult(
        polygons=[[p_a, p_b]],
        empty_plates=[],
        original_bounds=(0, 10),
        assembled_height=5.0,
        auto_scale=1.0,
        warnings=[]
    )

    dxf_m_path = "tmp_test_multi.dxf"
    svg_m_path = "tmp_test_multi.svg"

    ok, _ = export_dxf(multi_res, dxf_m_path)
    assert ok
    doc_m = ezdxf.readfile(dxf_m_path)
    msp_m = doc_m.modelspace()
    polys_m = list(msp_m.query('LWPOLYLINE[layer=="PLACA_01"]'))
    assert len(polys_m) == 2, f"Esperadas 2 polilineas en PLACA_01, obtenidas {len(polys_m)}"

    ok, _ = export_svg(multi_res, svg_m_path)
    assert ok
    with open(svg_m_path, "r", encoding="utf-8") as f:
        svg_m_content = f.read()
    assert svg_m_content.count("<path") == 2, "SVG debe tener 2 elementos <path> para los 2 poligonos separados"
    print("[OK] Múltiples polígonos por placa exportados correctamente.")

    # ---------------------------------------------------------
    # 6. Desactivación de marcas de alineación
    # ---------------------------------------------------------
    print("\n[6] Probando add_alignment_marks=False...")
    dxf_nomarks_path = "tmp_test_nomarks.dxf"
    svg_nomarks_path = "tmp_test_nomarks.svg"

    ok, _ = export_dxf(res_box, dxf_nomarks_path, add_alignment_marks=False)
    assert ok
    doc_no = ezdxf.readfile(dxf_nomarks_path)
    assert "ALINEACION" not in [l.dxf.name for l in doc_no.layers]
    assert len(list(doc_no.modelspace().query('CIRCLE'))) == 0

    ok, _ = export_svg(res_box, svg_nomarks_path, add_alignment_marks=False)
    assert ok
    with open(svg_nomarks_path, "r", encoding="utf-8") as f:
        svg_no_content = f.read()
    assert "alignment-marks" not in svg_no_content
    assert "<circle" not in svg_no_content
    print("[OK] Desactivación de marcas de alineación verificada.")

    # ---------------------------------------------------------
    # 7. Limpieza de archivos temporales
    # ---------------------------------------------------------
    for path in [
        dxf_box_path, svg_box_path,
        dxf_torus_path, svg_torus_path,
        dxf_l_path, svg_l_path,
        dxf_m_path, svg_m_path,
        dxf_nomarks_path, svg_nomarks_path
    ]:
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass

    print("\n" + "=" * 60)
    print("TODAS LAS PRUEBAS DE FASE 2 PASARON CON EXITO!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
