"""
test_slice.py — Suite de pruebas para la Fase 1 (Slicing Headless y Validaciones).
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
import trimesh.transformations as tx
from shapely.geometry import Polygon

from validator import validate_file, validate_params, validate_mesh
from slicer import slice_mesh, path2d_to_shapely


def run_tests():
    print("=" * 60)
    print("EJECUTANDO PRUEBAS DE FASE 1 -- Slicing Headless")
    print("=" * 60)

    # ---------------------------------------------------------
    # 1. Pruebas de validación de parámetros
    # ---------------------------------------------------------
    print("\n[1] Probando validate_params...")
    ok, msg = validate_params(plates=1, gap=2.0, thickness=3.0)
    assert not ok and "al menos 2 placas" in msg, f"Fallo en plates=1: {msg}"

    ok, msg = validate_params(plates=5, gap=-1.0, thickness=3.0)
    assert not ok and "negativa" in msg, f"Fallo en gap < 0: {msg}"

    ok, msg = validate_params(plates=5, gap=2.0, thickness=0.0)
    assert not ok and "mayor a 0" in msg, f"Fallo en thickness=0: {msg}"

    ok, msg = validate_params(plates=5, gap=2.0, thickness=3.0)
    assert ok and msg == "", f"Fallo en params validos: {msg}"
    print("[OK] validate_params paso todas las pruebas.")

    # ---------------------------------------------------------
    # 2. Pruebas de validación de archivo
    # ---------------------------------------------------------
    print("\n[2] Probando validate_file...")
    ok, msg = validate_file("archivo_inexistente.obj")
    assert not ok and "no existe" in msg, f"Fallo archivo inexistente: {msg}"

    ok, msg = validate_file("README.md")
    assert not ok and "Solo se aceptan archivos OBJ o STL" in msg, f"Fallo extension invalida: {msg}"

    # Crear archivo OBJ corrupto (.txt renombrado a .obj)
    corrupt_path = "test_corrupt.obj"
    with open(corrupt_path, "w", encoding="utf-8") as f:
        f.write("esto no es un archivo 3D")

    ok, msg = validate_file(corrupt_path)
    assert ok, "validate_file debe chequear extension y existencia"

    corrupt_mesh = trimesh.load(corrupt_path, force='mesh')
    m_ok, m_msg, _ = validate_mesh(corrupt_mesh)
    assert not m_ok and "0 vértices" in m_msg, f"Fallo deteccion mesh vacio: {m_msg}"
    if os.path.exists(corrupt_path):
        os.remove(corrupt_path)
    print("[OK] validate_file y deteccion de archivo corrupto pasaron.")

    # ---------------------------------------------------------
    # 3. Crear modelo L-block asimétrico para pruebas geométricas
    # ---------------------------------------------------------
    print("\n[3] Generando y probando L-block asimetrico (test_l_block.obj)...")
    # Base: 30x10, Columna: 10x30 en plano X-Z, extruido 15 mm en Y
    l_poly = Polygon([(0, 0), (30, 0), (30, 10), (10, 10), (10, 30), (0, 30)])
    l_mesh = trimesh.creation.extrude_polygon(l_poly, height=15)
    # Rotar 90° en X para que el perfil en L quede en XZ
    l_mesh.apply_transform(tx.rotation_matrix(np.pi / 2, [1, 0, 0]))

    l_block_path = "test_l_block.obj"
    l_mesh.export(l_block_path)

    ok, msg = validate_file(l_block_path)
    assert ok, f"Error validando test_l_block.obj: {msg}"

    loaded_mesh = trimesh.load(l_block_path, force='mesh')
    ok, msg, repaired = validate_mesh(loaded_mesh)
    assert ok, f"Error validando mesh de test_l_block.obj: {msg}"

    # Slicing en Z
    result_z = slice_mesh(loaded_mesh, plates=5, gap=2.0, thickness=3.0, axis='z')
    valid_plates_z = [p for p in result_z.polygons if p is not None]
    assert len(valid_plates_z) == 5, f"Esperadas 5 placas en Z, obtenidas {len(valid_plates_z)}"

    # Verificar que las coordenadas están en mm
    poly_sample = valid_plates_z[2][0]
    minx, miny, maxx, maxy = poly_sample.bounds
    width_mm = maxx - minx
    assert 5.0 <= width_mm <= 35.0, f"Bounds no razonables en mm: ({minx}, {miny}, {maxx}, {maxy})"

    # Verificar preservación de posición relativa (centroides desplazados)
    c0 = valid_plates_z[0][0].centroid
    c4 = valid_plates_z[4][0].centroid
    assert abs(c0.x - c4.x) > 1.0, f"Centroides no reflejan asimetria: c0={c0.x}, c4={c4.x}"
    print(f"[OK] Centroides en Z varian correctamente: base x={c0.x:.2f}, columna x={c4.x:.2f}")

    # Verificar orden y orientación en ejes X e Y
    result_x = slice_mesh(loaded_mesh, plates=5, gap=2.0, thickness=3.0, axis='x')
    p0_x = result_x.polygons[0][0].bounds
    p4_x = result_x.polygons[4][0].bounds
    dim0_x = p0_x[2] - p0_x[0]
    dim4_x = p4_x[2] - p4_x[0]
    # Placa 0 (inicio de X) debe ser la sección más ancha/alta
    assert dim0_x > dim4_x, f"Orden de eje X invertido: dim0={dim0_x}, dim4={dim4_x}"
    print(f"[OK] Eje X ordenado correctamente (+X -> +Z): dim0={dim0_x:.2f}mm > dim4={dim4_x:.2f}mm")

    result_y = slice_mesh(loaded_mesh, plates=5, gap=2.0, thickness=3.0, axis='y')
    assert len([p for p in result_y.polygons if p is not None]) == 5
    print("[OK] Eje Y rebanado correctamente.")

    # ---------------------------------------------------------
    # 4. Prueba con Cubo
    # ---------------------------------------------------------
    print("\n[4] Probando Cubo (box)...")
    box = trimesh.creation.box(extents=[20, 20, 20])
    res_box = slice_mesh(box, plates=5, gap=2.0, thickness=3.0, axis='z')
    assert len(res_box.empty_plates) == 0, "El cubo no debe tener placas vacias"
    assert len(res_box.warnings) == 0, "El cubo no debe tener advertencias"
    assert len(res_box.polygons) == 5, "El cubo debe producir 5 poligonos"
    for i, p in enumerate(res_box.polygons):
        assert len(p) == 1, f"Placa {i} debe tener 1 poligono"
        b = p[0].bounds
        assert abs((b[2] - b[0]) - (b[3] - b[1])) < 1e-3, f"Placa {i} no es cuadrada"
    print("[OK] Cubo: 5 placas rectangulares, 0 vacias, 0 advertencias.")

    # ---------------------------------------------------------
    # 5. Prueba con Esfera
    # ---------------------------------------------------------
    print("\n[5] Probando Esfera (icosphere)...")
    sphere = trimesh.creation.icosphere(radius=15, subdivisions=3)
    res_sphere = slice_mesh(sphere, plates=10, gap=1.0, thickness=2.0, axis='z')
    assert len(res_sphere.empty_plates) == 0, f"Placas vacias en esfera: {res_sphere.empty_plates}"
    valid_count = len([p for p in res_sphere.polygons if p is not None])
    assert valid_count == 10, f"Esperadas 10 placas en esfera, obtenidas {valid_count}"
    print("[OK] Esfera: 10 cortes validos, 0 placas vacias.")

    # ---------------------------------------------------------
    # 6. Prueba con Torus (modelo con hueco / dona)
    # ---------------------------------------------------------
    print("\n[6] Probando Torus (modelo con hueco)...")
    torus = trimesh.creation.torus(major_radius=20, minor_radius=8)
    res_torus = slice_mesh(torus, plates=7, gap=1.0, thickness=2.0, axis='z')
    holes_found = False
    for i, p in enumerate(res_torus.polygons):
        if p and len(p[0].interiors) > 0:
            holes_found = True
            break
    assert holes_found, "El toroide debe contener poligonos con huecos (interiors)"
    print("[OK] Torus: huecos detectados correctamente en las placas.")

    # ---------------------------------------------------------
    # 7. Prueba del fallback de nesting en path2d_to_shapely
    # ---------------------------------------------------------
    print("\n[7] Probando fallback de nesting en path2d_to_shapely...")
    class MockPath2D:
        @property
        def polygons_full(self):
            return []  # Simula falla en polygons_full
        @property
        def discrete(self):
            # Contorno exterior de 20x20 y hueco interior de 6x6
            outer = np.array([[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]])
            inner = np.array([[-3, -3], [3, -3], [3, 3], [-3, 3], [-3, -3]])
            return [outer, inner]

    fallback_polys = path2d_to_shapely(MockPath2D())
    assert len(fallback_polys) == 1, "Fallback debe reconstruir 1 poligono con hueco"
    assert len(fallback_polys[0].interiors) == 1, "Fallback debe tener 1 hueco interior"
    assert abs(fallback_polys[0].area - 364.0) < 1e-3, f"Area incorrecta en fallback: {fallback_polys[0].area}"
    print("[OK] Fallback de nesting: reconstruccion correcta de poligono con hueco.")

    print("\n" + "=" * 60)
    print("TODAS LAS PRUEBAS DE FASE 1 PASARON CON EXITO!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
