// TODO: Move duplicated logic between geometry layrs into GeometryLayer

// TODO: Look at ways to drop unneeded references to array buffers, etc to
// reduce memory footprint

// TODO: Support dynamic updating / hiding / animation of geometry
//
// This could be pretty hard as it's all packed away within BufferGeometry and
// may even be merged by another layer (eg. GeoJSONLayer)
//
// How much control should this layer support? Perhaps a different or custom
// layer would be better suited for animation, for example.

// TODO: Allow _setBufferAttributes to use a custom function passed in to
// generate a custom mesh

import World from '../../World';

import Layer from '../Layer';
import THREE from 'three';
import {latLon as LatLon} from '../../geo/LatLon';
import {point as Point} from '../../geo/Point';
import earcut from 'earcut';
import extrudePolygon from '../../util/extrudePolygon';
import Buffer from '../../util/Buffer';

class PolygonLayer extends Layer {

    constructor(coordinates, options, tile) {
        var defaults = {
            output: true,
            interactive: false,
            // Custom material override
            //
            // TODO: Should this be in the style object?
            material: null,
            onMesh: null,
            onBufferAttributes: null,
            // This default style is separate to Util.GeoJSON.defaultStyle
            style: {
                color: '#ffffff',
                transparent: false,
                opacity: 1,
                blending: THREE.NormalBlending,
                height: 0
            }
        };

        var _options = Object.assign({}, defaults, options);

        super(_options, tile);

        this._angleProportion = 0;//0.005;

        this._U_shift = 0;//0.01;//0.005;
        this._V_shift = 0;//0.01;//0.005;

        // Return coordinates as array of polygons so it's easy to support
        // MultiPolygon features (a single polygon would be a MultiPolygon with a
        // single polygon in the array)
        this._coordinates = (PolygonLayer.isSingle(coordinates)) ? [coordinates] : coordinates;

    }

    _onAdd(world) {

        this._world = world;

        this._setCoordinates();

        // Store geometry representation as instances of THREE.BufferAttribute
        this._setBufferAttributes();
        if (this._options.output) {
            // Set mesh if not merging elsewhere
            this._setMesh(this._bufferAttributes);

            // Output mesh
            this.add(this._mesh);
        }
    }

    // Return center of polygon as a LatLon
    //
    // This is used for things like placing popups / UI elements on the layer
    //
    // TODO: Find proper center position instead of returning first coordinate
    // SEE: https://github.com/Leaflet/Leaflet/blob/master/src/layer/vector/Polygon.js#L15
    getCenter() {
        return this._center;
    }

    // Return polygon bounds in geographic coordinates
    //
    // TODO: Implement getBounds()
    getBounds() {
    }

    _calc_X_UV(xPos, zPos, tile) {

        let _deltaU = Math.abs(tile.coord.x - xPos);

        if (zPos > 0) {
            _deltaU = _deltaU * (1 - this._angleProportion);
        }

        var _U = (_deltaU / tile.width).toFixed(4);

        if (_U > 0 && _U < 1) {
            _U += this._U_shift
        }

        return _U;

    }

    _calc_Y_UV(yPos, zPos, tile) {

        let _deltaV = Math.abs(tile.coord.y - yPos);
        if (zPos > 0) {
            _deltaV = _deltaV * (1 - this._angleProportion);
        }
        var _V = (_deltaV / tile.height).toFixed(4);

        if (_V > 0 && _V < 1) {
            _V += this._V_shift;
        }

        return _V;

    }

    // Create and store reference to THREE.BufferAttribute data for this layer
    _setBufferAttributes() {
        var attributes;

        // Only use this if you know what you're doing
        if (typeof this._options.onBufferAttributes === 'function') {
            // TODO: Probably want to pass something less general as arguments,
            // though passing the instance will do for now (it's everything)
            attributes = this._options.onBufferAttributes(this);
        } else {
            var height = 0;

            // Convert height into world units
            if (this._options.style.height && this._options.style.height !== 0) {
                height = this._world.metresToWorld(this._options.style.height, this._pointScale);
            }

            let min_height = this._options.style.min_height;

            if (height === 0 || min_height === undefined) {
                min_height = 0;
            }

            min_height = this._world.metresToWorld(min_height, this._pointScale);

            if (this._options.style.dump) {
                console.log('Heights: ', height, min_height);
            }

            var colour = new THREE.Color();
            colour.set(this._options.style.color);

            // Light and dark colours used for poor-mans AO gradient on object sides
            var light = new THREE.Color(0xffffff);
            var shadow = new THREE.Color(0x666666);

            // For each polygon
            attributes = this._projectedCoordinates.map(_projectedCoordinates => {

                let simplifedCoordinates = simplify(_projectedCoordinates, 200, true);

                // Convert coordinates to earcut format
                let _earcut = this._toEarcut(simplifedCoordinates);

                // Triangulate faces using earcut
                let faces = this._triangulate(_earcut.vertices, _earcut.holes, _earcut.dimensions);

                let groupedVertices = [];

                for (var i = 0, il = _earcut.vertices.length; i < il; i += _earcut.dimensions) {
                    groupedVertices.push(_earcut.vertices.slice(i, i + _earcut.dimensions));
                }


                if (min_height > 0) {
                    //    console.log('min_height : %j', min_height);
                }

                let extruded = extrudePolygon(groupedVertices, faces, {
                    bottom: min_height,
                    top: height
                });

                let topColor = colour.clone().multiply(light);
                let bottomColor = colour.clone().multiply(shadow);

                let _vertices = extruded.positions;
                let _faces = [];

                const _colours = [];

                extruded.top.forEach((face, fi) => {

                    _faces.push(face);

                    const _colour = [];

                    _colour.push([colour.r, colour.g, colour.b]);
                    _colour.push([colour.r, colour.g, colour.b]);
                    _colour.push([colour.r, colour.g, colour.b]);

                    _colours.push(_colour);
                });

                this._flat = true;

                if (extruded.sides) {
                    this._flat = false;

                    // Set up colours for every vertex with poor-mans AO on the sides
                    extruded.sides.forEach((face, fi) => {
                        const _colour = [];

                        // First face is always bottom-bottom-top
                        if (fi % 2 === 0) {
                            _colour.push([bottomColor.r, bottomColor.g, bottomColor.b]);
                            _colour.push([bottomColor.r, bottomColor.g, bottomColor.b]);
                            _colour.push([topColor.r, topColor.g, topColor.b]);
                            // Reverse winding for the second face
                            // top-top-bottom
                        } else {
                            _colour.push([topColor.r, topColor.g, topColor.b]);
                            _colour.push([topColor.r, topColor.g, topColor.b]);
                            _colour.push([bottomColor.r, bottomColor.g, bottomColor.b]);
                        }

                        _faces.push(face);
                        _colours.push(_colour);
                    });
                }

                // Skip bottom as there's no point rendering it
                // allFaces.push(extruded.faces);

                var polygon = {
                    vertices: _vertices,
                    faces: _faces,
                    colours: _colours,
                    facesCount: _faces.length,
                };

                if (this._options.interactive && this._pickingId) {
                    // Inject picking ID
                    polygon.pickingId = this._pickingId;
                }

                // Convert polygon representation to proper attribute arrays
                return this._toAttributes(polygon);
            });
        }

        this._bufferAttributes = Buffer.mergeAttributes(attributes);

        // Original attributes are no longer required so free the memory
        attributes = null;
    }

    getBufferAttributes() {
        return this._bufferAttributes;
    }

    // Used by external components to clear some memory when the attributes
    // are no longer required to be stored in this layer
    //
    // For example, you would want to clear the attributes here after merging them
    // using something like the GeoJSONLayer
    clearBufferAttributes() {
        this._bufferAttributes = null;
    }

    // Used by external components to clear some memory when the coordinates
    // are no longer required to be stored in this layer
    //
    // For example, you would want to clear the coordinates here after this
    // layer is merged in something like the GeoJSONLayer
    clearCoordinates() {
        this._coordinates = null;
        this._projectedCoordinates = null;
    }

    // Create and store mesh from buffer attributes
    //
    // This is only called if the layer is controlling its own output
    _setMesh(attributes) {
        var geometry = new THREE.BufferGeometry();

        // itemSize = 3 because there are 3 values (components) per vertex
        geometry.setAttribute('position', new THREE.BufferAttribute(attributes.vertices, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(attributes.normals, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(attributes.colours, 3));

        if (attributes.pickingIds) {
            geometry.setAttribute('pickingId', new THREE.BufferAttribute(attributes.pickingIds, 1));
        }

        geometry.computeBoundingBox();

        var material;
        if (this._options.material && this._options.material instanceof THREE.Material) {
            material = this._options.material;
        } else {
            material = new THREE.MeshPhongMaterial({
                vertexColors: THREE.VertexColors,
                side: THREE.BackSide,
                transparent: this._options.style.transparent,
                opacity: this._options.style.opacity,
                blending: this._options.style.blending
            });
        }

        var mesh;

        // Pass mesh through callback, if defined
        if (typeof this._options.onMesh === 'function') {
            mesh = this._options.onMesh(geometry, material);
        } else {
            mesh = new THREE.Mesh(geometry, material);

            mesh.castShadow = true;
            mesh.receiveShadow = true;
        }

        if (this.isFlat()) {
            material.depthWrite = false;
            mesh.renderOrder = 1;
        }

        this._mesh = mesh;
    }

    // Convert and project coordinates
    //
    // TODO: Calculate bounds
    _setCoordinates() {
        this._bounds = [];
        this._coordinates = this._convertCoordinates(this._coordinates);

        this._projectedBounds = [];
        this._projectedCoordinates = this._projectCoordinates();

        this._center = this._coordinates[0][0][0];
    }

    // Recursively convert input coordinates into LatLon objects
    //
    // Calculate geographic bounds at the same time
    //
    // TODO: Calculate geographic bounds
    _convertCoordinates(coordinates) {
        return coordinates.map(_coordinates => {
            return _coordinates.map(ring => {
                return ring.map(coordinate => {
                    return LatLon(coordinate[1], coordinate[0]);
                });
            });
        });
    }

    // Recursively project coordinates into world positions
    //
    // Calculate world bounds, offset and pointScale at the same time
    //
    // TODO: Calculate world bounds
    _projectCoordinates() {
        var point;
        return this._coordinates.map(_coordinates => {
            return _coordinates.map(ring => {
                return ring.map(latlon => {

                    point = this._world.latLonToPoint(latlon);

                    // TODO: Is offset ever being used or needed?
                    if (!this._offset) {
                        this._offset = Point(0, 0);
                        this._offset.x = -1 * point.x;
                        this._offset.y = -1 * point.y;

                        this._pointScale = World.pointScale(latlon);
                    }

                    return point;
                });
            });
        });
    }

    // Convert coordinates array to something earcut can understand
    _toEarcut(coordinates) {
        var dim = 2;
        var result = {vertices: [], holes: [], dimensions: dim};
        var holeIndex = 0;

        for (var i = 0; i < coordinates.length; i++) {
            for (var j = 0; j < coordinates[i].length; j++) {
                // for (var d = 0; d < dim; d++) {
                result.vertices.push(coordinates[i][j].x);
                result.vertices.push(coordinates[i][j].y);
                // }
            }
            if (i > 0) {
                holeIndex += coordinates[i - 1].length;
                result.holes.push(holeIndex);
            }
        }

        return result;
    }

    // Triangulate earcut-based input using earcut
    _triangulate(contour, holes, dim) {
        // console.time('earcut');

        var faces = earcut(contour, holes, dim);
        var result = [];

        for (var i = 0, il = faces.length; i < il; i += 3) {
            result.push(faces.slice(i, i + 3));
        }

        // console.timeEnd('earcut');

        return result;
    }

    // Transform polygon representation into attribute arrays that can be used by
    // THREE.BufferGeometry
    //
    // TODO: Can this be simplified? It's messy and huge
    _toAttributes(polygon) {

        // Three components per vertex per face (3 x 3 = 9)
        var vertices = new Float32Array(polygon.facesCount * 9);
        var normals = new Float32Array(polygon.facesCount * 9);
        var colours = new Float32Array(polygon.facesCount * 9);
        // Two components per vertex per face
        var uvs = new Float32Array(polygon.facesCount * 6);

        var pickingIds;
        if (polygon.pickingId) {
            // One component per vertex per face (1 x 3 = 3)
            pickingIds = new Float32Array(polygon.facesCount * 3);
        }

        var pA = new THREE.Vector3();
        var pB = new THREE.Vector3();
        var pC = new THREE.Vector3();

        var cb = new THREE.Vector3();
        var ab = new THREE.Vector3();

        var index;

        var _faces = polygon.faces;
        var _vertices = polygon.vertices;
        var _colour = polygon.colours;

        var _pickingId;
        if (pickingIds) {
            _pickingId = polygon.pickingId;
        }

        var lastIndex = 0;

        for (var i = 0; i < _faces.length; i++) {
            // Array of vertex indexes for the face
            index = _faces[i][0];

            var ax = _vertices[index][0];
            var ay = _vertices[index][1];
            var az = _vertices[index][2];

            var c1 = _colour[i][0];

            index = _faces[i][1];

            var bx = _vertices[index][0];
            var by = _vertices[index][1];
            var bz = _vertices[index][2];

            var c2 = _colour[i][1];

            index = _faces[i][2];

            var cx = _vertices[index][0];
            var cy = _vertices[index][1];
            var cz = _vertices[index][2];

            var c3 = _colour[i][2];

            // Flat face normals
            // From: http://threejs.org/examples/webgl_buffergeometry.html
            pA.set(ax, ay, az);
            pB.set(bx, by, bz);
            pC.set(cx, cy, cz);

            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);

            cb.normalize();

            var nx = cb.x;
            var ny = cb.y;
            var nz = cb.z;

            vertices[lastIndex * 9 + 0] = ax;
            vertices[lastIndex * 9 + 1] = ay;
            vertices[lastIndex * 9 + 2] = az;

            if (this._isTile) {
                uvs[lastIndex * 6 + 0] = this._calc_X_UV(ax, ay, this._tile);
                uvs[lastIndex * 6 + 1] = this._calc_Y_UV(az, ay, this._tile);
            }


            normals[lastIndex * 9 + 0] = nx;
            normals[lastIndex * 9 + 1] = ny;
            normals[lastIndex * 9 + 2] = nz;

            colours[lastIndex * 9 + 0] = c1[0];
            colours[lastIndex * 9 + 1] = c1[1];
            colours[lastIndex * 9 + 2] = c1[2];

            vertices[lastIndex * 9 + 3] = bx;
            vertices[lastIndex * 9 + 4] = by;
            vertices[lastIndex * 9 + 5] = bz;


            if (this._isTile) {
                uvs[lastIndex * 6 + 2] = this._calc_X_UV(bx, by, this._tile);
                uvs[lastIndex * 6 + 3] = this._calc_Y_UV(bz, by, this._tile);
            }

            normals[lastIndex * 9 + 3] = nx;
            normals[lastIndex * 9 + 4] = ny;
            normals[lastIndex * 9 + 5] = nz;

            colours[lastIndex * 9 + 3] = c2[0];
            colours[lastIndex * 9 + 4] = c2[1];
            colours[lastIndex * 9 + 5] = c2[2];

            vertices[lastIndex * 9 + 6] = cx;
            vertices[lastIndex * 9 + 7] = cy;
            vertices[lastIndex * 9 + 8] = cz;

            if (this._isTile) {
                uvs[lastIndex * 6 + 4] = this._calc_X_UV(cx, cy, this._tile);
                uvs[lastIndex * 6 + 5] = this._calc_Y_UV(cz, cy, this._tile);
            }

            normals[lastIndex * 9 + 6] = nx;
            normals[lastIndex * 9 + 7] = ny;
            normals[lastIndex * 9 + 8] = nz;

            colours[lastIndex * 9 + 6] = c3[0];
            colours[lastIndex * 9 + 7] = c3[1];
            colours[lastIndex * 9 + 8] = c3[2];

            if (pickingIds) {
                pickingIds[lastIndex * 3 + 0] = _pickingId;
                pickingIds[lastIndex * 3 + 1] = _pickingId;
                pickingIds[lastIndex * 3 + 2] = _pickingId;
            }

            lastIndex++;
        }

        var attributes = {
            vertices: vertices,
            normals: normals,
            colours: colours,
            uvs: uvs
        };

        if (pickingIds) {
            attributes.pickingIds = pickingIds;
        }

        return attributes;
    }

    // Returns true if the polygon is flat (has no height)
    isFlat() {
        return this._flat;
    }

    // Returns true if coordinates refer to a single geometry
    //
    // For example, not coordinates for a MultiPolygon GeoJSON feature
    static isSingle(coordinates) {
        if (!coordinates[0]) {
            console.log(coordinates);
        }
        return !Array.isArray(coordinates[0][0][0]);
    }

    // TODO: Make sure this is cleaning everything
    destroy() {
        if (this._pickingMesh) {
            // TODO: Properly dispose of picking mesh
            this._pickingMesh = null;
        }

        this.clearCoordinates();
        this.clearBufferAttributes();

        // Run common destruction logic from parent
        super.destroy();
    }
}

export default PolygonLayer;

var noNew = function (coordinates, options) {
    return new PolygonLayer(coordinates, options);
};

export {noNew as polygonLayer};
