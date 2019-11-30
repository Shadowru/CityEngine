import THREE from 'three';
import { feature } from 'topojson';
import geojsonMerge from 'geojson-merge';
import earcut from 'earcut';

/*
 * LatLon is a helper class for ensuring consistent geographic coordinates.
 *
 * Based on:
 * https://github.com/Leaflet/Leaflet/blob/master/src/geo/LatLng.js
 */

class LatLon {
  constructor(lat, lon, alt) {
    if (isNaN(lat) || isNaN(lon)) {
      throw new Error('Invalid LatLon object: (' + lat + ', ' + lon + ')');
    }

    this.lat = +lat;
    this.lon = +lon;

    if (alt !== undefined) {
      this.alt = +alt;
    }
  }

  clone() {
    return new LatLon(this.lat, this.lon, this.alt);
  }
}

// Accepts (LatLon), ([lat, lon, alt]), ([lat, lon]) and (lat, lon, alt)
// Also converts between lng and lon
var noNew = function(a, b, c) {
  if (a instanceof LatLon) {
    return a;
  }
  if (Array.isArray(a) && typeof a[0] !== 'object') {
    if (a.length === 3) {
      return new LatLon(a[0], a[1], a[2]);
    }
    if (a.length === 2) {
      return new LatLon(a[0], a[1]);
    }
    return null;
  }
  if (a === undefined || a === null) {
    return a;
  }
  if (typeof a === 'object' && 'lat' in a) {
    return new LatLon(a.lat, 'lng' in a ? a.lng : a.lon, a.alt);
  }
  if (b === undefined) {
    return null;
  }
  return new LatLon(a, b, c);
};

/*
 * Point is a helper class for ensuring consistent world positions.
 *
 * Based on:
 * https://github.com/Leaflet/Leaflet/blob/master/src/geo/Point.js
 */

class Point {
  constructor(x, y, round) {
    this.x = (round ? Math.round(x) : x);
    this.y = (round ? Math.round(y) : y);
  }

  clone() {
    return new Point(this.x, this.y);
  }

  // Non-destructive
  add(point) {
    return this.clone()._add(_point(point));
  }

  // Destructive
  _add(point) {
    this.x += point.x;
    this.y += point.y;
    return this;
  }

  // Non-destructive
  subtract(point) {
    return this.clone()._subtract(_point(point));
  }

  // Destructive
  _subtract(point) {
    this.x -= point.x;
    this.y -= point.y;
    return this;
  }
}

// Accepts (point), ([x, y]) and (x, y, round)
var _point = function(x, y, round) {
  if (x instanceof Point) {
    return x;
  }
  if (Array.isArray(x)) {
    return new Point(x[0], x[1]);
  }
  if (x === undefined || x === null) {
    return x;
  }
  return new Point(x, y, round);
};

var Geo = {};

// Radius / WGS84 semi-major axis
Geo.R = 6378137;
Geo.MAX_LATITUDE = 85.0511287798;

// WGS84 eccentricity
Geo.ECC = 0.081819191;
Geo.ECC2 = 0.081819191 * 0.081819191;

Geo.project = function(latlon) {
  var d = Math.PI / 180;
  var max = Geo.MAX_LATITUDE;
  var lat = Math.max(Math.min(max, latlon.lat), -max);
  var sin = Math.sin(lat * d);

  return _point(
    Geo.R * latlon.lon * d,
    Geo.R * Math.log((1 + sin) / (1 - sin)) / 2
  );
},

Geo.unproject = function(point) {
  var d = 180 / Math.PI;

  return noNew(
    (2 * Math.atan(Math.exp(point.y / Geo.R)) - (Math.PI / 2)) * d,
    point.x * d / Geo.R
  );
};

// Converts geo coords to pixel / WebGL ones
// This just reverses the Y axis to match WebGL
Geo.latLonToPoint = function(latlon) {
  var projected = Geo.project(latlon);
  projected.y *= -1;

  return projected;
};

// Converts pixel / WebGL coords to geo coords
// This just reverses the Y axis to match WebGL
Geo.pointToLatLon = function(point) {
  var _point$1 = _point(point.x, point.y * -1);
  return Geo.unproject(_point$1);
};

// Scale factor for converting between real metres and projected metres
//
// projectedMetres = realMetres * pointScale
// realMetres = projectedMetres / pointScale
//
// Accurate scale factor uses proper Web Mercator scaling
// See pg.9: http://www.hydrometronics.com/downloads/Web%20Mercator%20-%20Non-Conformal,%20Non-Mercator%20(notes).pdf
// See: http://jsfiddle.net/robhawkes/yws924cf/
Geo.pointScale = function(latlon, accurate) {
  var rad = Math.PI / 180;

  var k;

  if (!accurate) {
    k = 1 / Math.cos(latlon.lat * rad);

    // [scaleX, scaleY]
    return [k, k];
  } else {
    var lat = latlon.lat * rad;
    var lon = latlon.lon * rad;

    var a = Geo.R;

    var sinLat = Math.sin(lat);
    var sinLat2 = sinLat * sinLat;

    var cosLat = Math.cos(lat);

    // Radius meridian
    var p = a * (1 - Geo.ECC2) / Math.pow(1 - Geo.ECC2 * sinLat2, 3 / 2);

    // Radius prime meridian
    var v = a / Math.sqrt(1 - Geo.ECC2 * sinLat2);

    // Scale N/S
    var h = (a / p) / cosLat;

    // Scale E/W
    k = (a / v) / cosLat;

    // [scaleX, scaleY]
    return [k, h];
  }
};

// Convert real metres to projected units
//
// Latitude scale is chosen because it fluctuates more than longitude
Geo.metresToProjected = function(metres, pointScale) {
  return metres * pointScale[1];
};

// Convert projected units to real metres
//
// Latitude scale is chosen because it fluctuates more than longitude
Geo.projectedToMetres = function(projectedUnits, pointScale) {
  return projectedUnits / pointScale[1];
};

// Convert real metres to a value in world (WebGL) units
Geo.metresToWorld = function(metres, pointScale) {
  // Transform metres to projected metres using the latitude point scale
  //
  // Latitude scale is chosen because it fluctuates more than longitude
  var projectedMetres = Geo.metresToProjected(metres, pointScale);

  var scale = Geo.scale();

  // Scale projected metres
  var scaledMetres = (scale * projectedMetres);

  return scaledMetres;
};

// Convert world (WebGL) units to a value in real metres
Geo.worldToMetres = function(worldUnits, pointScale) {
  var scale = Geo.scale();

  var projectedUnits = worldUnits / scale;
  var realMetres = Geo.projectedToMetres(projectedUnits, pointScale);

  return realMetres;
};

// If zoom is provided, returns the map width in pixels for a given zoom
// Else, provides fixed scale value
Geo.scale = function(zoom) {
  // If zoom is provided then return scale based on map tile zoom
  if (zoom >= 0) {
    return 256 * Math.pow(2, zoom);
  // Else, return fixed scale value to expand projected coordinates from
  // their 0 to 1 range into something more practical
  } else {
    return 1;
  }
};

// Returns zoom level for a given scale value
// This only works with a scale value that is based on map pixel width
Geo.zoom = function(scale) {
  return Math.log(scale / 256) / Math.LN2;
};

// Distance between two geographical points using spherical law of cosines
// approximation or Haversine
//
// See: http://www.movable-type.co.uk/scripts/latlong.html
Geo.distance = function(latlon1, latlon2, accurate) {
  var rad = Math.PI / 180;

  var lat1;
  var lat2;

  var a;

  if (!accurate) {
    lat1 = latlon1.lat * rad;
    lat2 = latlon2.lat * rad;

    a = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos((latlon2.lon - latlon1.lon) * rad);

    return Geo.R * Math.acos(Math.min(a, 1));
  } else {
    lat1 = latlon1.lat * rad;
    lat2 = latlon2.lat * rad;

    var lon1 = latlon1.lon * rad;
    var lon2 = latlon2.lon * rad;

    var deltaLat = lat2 - lat1;
    var deltaLon = lon2 - lon1;

    var halfDeltaLat = deltaLat / 2;
    var halfDeltaLon = deltaLon / 2;

    a = Math.sin(halfDeltaLat) * Math.sin(halfDeltaLat) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(halfDeltaLon) * Math.sin(halfDeltaLon);

    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Geo.R * c;
  }
};

Geo.bounds = (function() {
  var d = Geo.R * Math.PI;
  return [[-d, -d], [d, d]];
})();

class World {
    constructor(renderer, options) {

        var defaults = {
            postProcessing: false,
            scale: 1
        };

        this._options = Object.assign({}, defaults, options);
        this._layers = [];

        this._renderer = renderer;

        this._wordlObject3D = new THREE.Object3D();

    }

    setCoordinateSystem(coordinateSystemID) {
        //TODO: IMPLEMENT!!!!
    }

    setCoordinates(latlon) {
        this._originLatlon = latlon;
        this._originPoint = World.project(latlon);
    }

    getObject3D() {
        return this._wordlObject3D;
    }

    // Transform geographic coordinate to world point
    //
    // This doesn't take into account the origin offset
    //
    // For example, this takes a geographic coordinate and returns a point
    // relative to the origin point of the projection (not the world)
    static project(latlon) {
        return Geo.latLonToPoint(noNew(latlon));
    }

    // Transform world point to geographic coordinate
    //
    // This doesn't take into account the origin offset
    //
    // For example, this takes a point relative to the origin point of the
    // projection (not the world) and returns a geographic coordinate
    static unproject(point) {
        return Geo.pointToLatLon(_point(point));
    }


    rescalePoint(point){
        point.x = this.rescaleValue(point.x);
        point.y = this.rescaleValue(point.y);
        return point;
    }

    rescaleValue(value){
        return value * this._options.scale;
    }

    // Takes into account the origin offset
    //
    // For example, this takes a geographic coordinate and returns a point
    // relative to the three.js / 3D origin (0,0)
    latLonToPoint(latlon) {
        var projectedPoint = World.project(noNew(latlon));
        return(this.rescalePoint(projectedPoint._subtract(this._originPoint)));
    }

    // Takes into account the origin offset
    //
    // For example, this takes a point relative to the three.js / 3D origin (0,0)
    // and returns the exact geographic coordinate at that point
    pointToLatLon(point) {
        var projectedPoint = _point(point).add(this._originPoint);
        return unproject(projectedPoint);
    }

    // Convert from real meters to world units
    //
    // TODO: Would be nice not to have to pass in a pointscale here
    metresToWorld(metres, pointScale, zoom) {
        return this.rescaleValue(Geo.metresToWorld(metres, pointScale, zoom));
    }

    // Convert from real meters to world units
    //
    // TODO: Would be nice not to have to pass in a pointscale here
    static worldToMetres(worldUnits, pointScale, zoom) {
        return this.rescaleValue(Geo.worldToMetres(worldUnits, pointScale, zoom));
    }

    // Return pointscale for a given geographic coordinate
    static pointScale(latlon, accurate) {
        return Geo.pointScale(latlon, accurate);
    }

    addLayer(layer) {

        layer._world = this;

        this._layers.push(layer);

        layer.init();

        this._wordlObject3D.add(layer.getRootObject3D());
        return this;
    }

    // Remove layer from world and scene but don't destroy it entirely
    removeLayer(layer) {
        var layerIndex = this._layers.indexOf(layer);

        if (layerIndex > -1) {
            // Remove from this._layers
            this._layers.splice(layerIndex, 1);
        }
        return this;
    }


    destroy() {
        // Remove all layers
        var layer;
        for (var i = this._layers.length - 1; i >= 0; i--) {
            layer = this._layers[0];
            this.removeLayer(layer);
            layer.destroy();
        }
        this._wordlObject3D = null;
    }
}

var noNew$1 = function (domId, options) {
    return new World(domId, options);
};

class Layer {

    constructor(options, tile) {

        var defaults = {};

        this._options = Object.assign({}, defaults, options);

        this._rootObject3D = new THREE.Object3D();

        this._isTile = false;

        if (tile) {
            this._isTile = true;
            this._tile = tile;
        }

        if (this._isTile) ; else {
            console.log('isTile : ' + this._isTile);
        }

    }

    getRootObject3D() {
        return this._rootObject3D;
    }

    // Add THREE object directly to layer
    add(object) {
        this._rootObject3D.add(object);
    }

    // Remove THREE object from to layer
    remove(object) {
        this._rootObject3D.remove(object);
    }

    // Destroys the layer and removes it from the scene and memory
    destroy() {
        if (this._rootObject3D && this._rootObject3D.children) {
            // Remove everything else in the layer
            var child;
            for (var i = this._rootObject3D.children.length - 1; i >= 0; i--) {
                child = this._rootObject3D.children[i];

                if (!child) {
                    continue;
                }

                this.remove(child);

                if (child.geometry) {
                    // Dispose of mesh and materials
                    child.geometry.dispose();
                    child.geometry = null;
                }

                if (child.material) {
                    if (child.material.map) {
                        child.material.map.dispose();
                        child.material.map = null;
                    }

                    child.material.dispose();
                    child.material = null;
                }
            }
        }

        this._rootObject3D = null;
    }
}

class LayerGroup extends Layer {

    constructor(options, tile) {

        var defaults = {};

        var _options = Object.assign({}, defaults, options);

        super(_options, tile);

        this._layers = [];

    }

    addLayer(layer) {
        this._layers.push(layer);
        layer._onAdd(this._world);
    }

    removeLayer(layer) {
        var layerIndex = this._layers.indexOf(layer);

        if (layerIndex > -1) {
            // Remove from this._layers
            this._layers.splice(layerIndex, 1);
        }
    }

    destroy() {
        // TODO: Sometimes this is already null, find out why
        if (this._layers) {
            for (var i = 0; i < this._layers.length; i++) {
                this._layers[i].destroy();
            }

            this._layers = null;
        }

        super.destroy();
    }

}

/*
 * Extrude a polygon given its vertices and triangulated faces
 *
 * Based on:
 * https://github.com/freeman-lab/extrude
 */

var extrudePolygon = function (points, faces, _options) {
    var defaults = {
        top: 1,
        bottom: 0,
        closed: true
    };

    var options = Object.assign({}, defaults, _options);

    var n = points.length;
    var positions;
    var cells;
    var topCells;
    var bottomCells;
    var sideCells;

    // If bottom and top values are identical then return the flat shape
    (options.top === options.bottom) ? flat() : full();

    function flat() {
        positions = points.map(function (p) {
            return [p[0], options.top, p[1]];
        });
        cells = faces;
        topCells = faces;
    }

    function full() {
        positions = [];


        points.forEach(function (p) {
            positions.push([p[0], options.top, p[1]]);
        });

        points.forEach(function (p) {
            positions.push([p[0], options.bottom, p[1]]);
        });

        cells = [];
        for (var i = 0; i < n; i++) {
            if (i === (n - 1)) {
                cells.push([i + n, n, i]);
                cells.push([0, i, n]);
            } else {
                cells.push([i + n, i + n + 1, i]);
                cells.push([i + 1, i, i + n + 1]);
            }
        }

        sideCells = [].concat(cells);

        if (options.closed) {
            var top = faces;
            var bottom = top.map(function (p) {
                return p.map(function (v) {
                    return v + n;
                });
            });
            bottom = bottom.map(function (p) {
                return [p[0], p[2], p[1]];
            });
            cells = cells.concat(top).concat(bottom);

            topCells = top;
            bottomCells = bottom;
        }
    }

    return {
        positions: positions,
        faces: cells,
        top: topCells,
        bottom: bottomCells,
        sides: sideCells
    };
};

/*
 * GeoJSON helpers for handling data and generating objects
 */

// TODO: Make it so height can be per-coordinate / point but connected together
// as a linestring (eg. GPS points with an elevation at each point)
//
// This isn't really valid GeoJSON so perhaps something best left to an external
// component for now, until a better approach can be considered
//
// See: http://lists.geojson.org/pipermail/geojson-geojson.org/2009-June/000489.html

// Light and dark colours used for poor-mans AO gradient on object sides
var light = new THREE.Color(0xffffff);
var shadow  = new THREE.Color(0x666666);

var GeoJSON = (function() {
  var defaultStyle = {
    color: '#ffffff',
    transparent: false,
    opacity: 1,
    blending: THREE.NormalBlending,
    height: 0,
    lineOpacity: 1,
    lineTransparent: false,
    lineColor: '#ffffff',
    lineWidth: 1,
    lineBlending: THREE.NormalBlending
  };

  // Attempts to merge together multiple GeoJSON Features or FeatureCollections
  // into a single FeatureCollection
  var collectFeatures = function(data, _topojson) {
    var collections = [];

    if (_topojson) {
      // TODO: Allow TopoJSON objects to be overridden as an option

      // If not overridden, merge all features from all objects
      for (var tk in data.objects) {
        collections.push(feature(data, data.objects[tk]));
      }

      return geojsonMerge(collections);
    } else {
      // If root doesn't have a type then let's see if there are features in the
      // next step down
      if (!data.type) {
        // TODO: Allow GeoJSON objects to be overridden as an option

        // If not overridden, merge all features from all objects
        for (var gk in data) {
          if (!data[gk].type) {
            continue;
          }

          collections.push(data[gk]);
        }

        return geojsonMerge(collections);
      } else if (Array.isArray(data)) {
        return geojsonMerge(data);
      } else {
        return data;
      }
    }
  };

  // TODO: This is only used by GeoJSONTile so either roll it into that or
  // update GeoJSONTile to use the new GeoJSONLayer or geometry layers
  var lineStringAttributes = function(coordinates, colour, height) {
    var _coords = [];
    var _colours = [];

    var nextCoord;

    // Connect coordinate with the next to make a pair
    //
    // LineSegments requires pairs of vertices so repeat the last point if
    // there's an odd number of vertices
    coordinates.forEach((coordinate, index) => {
      _colours.push([colour.r, colour.g, colour.b]);
      _coords.push([coordinate[0], height, coordinate[1]]);

      nextCoord = (coordinates[index + 1]) ? coordinates[index + 1] : coordinate;

      _colours.push([colour.r, colour.g, colour.b]);
      _coords.push([nextCoord[0], height, nextCoord[1]]);
    });

    return {
      vertices: _coords,
      colours: _colours
    };
  };

  // TODO: This is only used by GeoJSONTile so either roll it into that or
  // update GeoJSONTile to use the new GeoJSONLayer or geometry layers
  var multiLineStringAttributes = function(coordinates, colour, height) {
    var _coords = [];
    var _colours = [];

    var result;
    coordinates.forEach(coordinate => {
      result = lineStringAttributes(coordinate, colour, height);

      result.vertices.forEach(coord => {
        _coords.push(coord);
      });

      result.colours.forEach(colour => {
        _colours.push(colour);
      });
    });

    return {
      vertices: _coords,
      colours: _colours
    };
  };

  // TODO: This is only used by GeoJSONTile so either roll it into that or
  // update GeoJSONTile to use the new GeoJSONLayer or geometry layers
  var polygonAttributes = function(coordinates, colour, height) {
    var earcutData = _toEarcut(coordinates);

    var faces = _triangulate(earcutData.vertices, earcutData.holes, earcutData.dimensions);

    var groupedVertices = [];
    for (var i = 0, il = earcutData.vertices.length; i < il; i += earcutData.dimensions) {
      groupedVertices.push(earcutData.vertices.slice(i, i + earcutData.dimensions));
    }

    var extruded = extrudePolygon(groupedVertices, faces, {
      bottom: 0,
      top: height
    });

    var topColor = colour.clone().multiply(light);
    var bottomColor = colour.clone().multiply(shadow);

    var _vertices = extruded.positions;
    var _faces = [];
    var _colours = [];

    var _colour;
    extruded.top.forEach((face, fi) => {
      _colour = [];

      _colour.push([colour.r, colour.g, colour.b]);
      _colour.push([colour.r, colour.g, colour.b]);
      _colour.push([colour.r, colour.g, colour.b]);

      _faces.push(face);
      _colours.push(_colour);
    });

    var allFlat = true;

    if (extruded.sides) {
      if (allFlat) {
        allFlat = false;
      }

      // Set up colours for every vertex with poor-mans AO on the sides
      extruded.sides.forEach((face, fi) => {
        _colour = [];

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

    return {
      vertices: _vertices,
      faces: _faces,
      colours: _colours,
      flat: allFlat
    };
  };

  // TODO: This is only used by GeoJSONTile so either roll it into that or
  // update GeoJSONTile to use the new GeoJSONLayer or geometry layers
  var _toEarcut = function(data) {
    var dim = data[0][0].length;
    var result = {vertices: [], holes: [], dimensions: dim};
    var holeIndex = 0;

    for (var i = 0; i < data.length; i++) {
      for (var j = 0; j < data[i].length; j++) {
        for (var d = 0; d < dim; d++) {
          result.vertices.push(data[i][j][d]);
        }
      }
      if (i > 0) {
        holeIndex += data[i - 1].length;
        result.holes.push(holeIndex);
      }
    }

    return result;
  };

  // TODO: This is only used by GeoJSONTile so either roll it into that or
  // update GeoJSONTile to use the new GeoJSONLayer or geometry layers
  var _triangulate = function(contour, holes, dim) {
    // console.time('earcut');

    var faces = earcut(contour, holes, dim);
    var result = [];

    for (i = 0, il = faces.length; i < il; i += 3) {
      result.push(faces.slice(i, i + 3));
    }

    // console.timeEnd('earcut');

    return result;
  };

  return {
    defaultStyle: defaultStyle,
    collectFeatures: collectFeatures,
    lineStringAttributes: lineStringAttributes,
    multiLineStringAttributes: multiLineStringAttributes,
    polygonAttributes: polygonAttributes
  };
})();

/*
 * BufferGeometry helpers
 */

var Buffer = (function() {
  // Merge multiple attribute objects into a single attribute object
  //
  // Attribute objects must all use the same attribute keys
  var mergeAttributes = function(attributes) {
    var lengths = {};

    // Find array lengths
    attributes.forEach(_attributes => {
      for (var k in _attributes) {
        if (!lengths[k]) {
          lengths[k] = 0;
        }

        lengths[k] += _attributes[k].length;
      }
    });

    var mergedAttributes = {};

    // Set up arrays to merge into
    for (var k in lengths) {
      mergedAttributes[k] = new Float32Array(lengths[k]);
    }

    var lastLengths = {};

    attributes.forEach(_attributes => {
      for (var k in _attributes) {
        if (!lastLengths[k]) {
          lastLengths[k] = 0;
        }

        mergedAttributes[k].set(_attributes[k], lastLengths[k]);

        lastLengths[k] += _attributes[k].length;
      }
    });

    return mergedAttributes;
  };

  var createLineGeometry = function(lines, offset) {
    var geometry = new THREE.BufferGeometry();

    var vertices = new Float32Array(lines.verticesCount * 3);
    var colours = new Float32Array(lines.verticesCount * 3);

    var pickingIds;
    if (lines.pickingIds) {
      // One component per vertex (1)
      pickingIds = new Float32Array(lines.verticesCount);
    }

    var _vertices;
    var _colour;
    var _pickingId;

    var lastIndex = 0;

    for (var i = 0; i < lines.vertices.length; i++) {
      _vertices = lines.vertices[i];
      _colour = lines.colours[i];

      if (pickingIds) {
        _pickingId = lines.pickingIds[i];
      }

      for (var j = 0; j < _vertices.length; j++) {
        var ax = _vertices[j][0] + offset.x;
        var ay = _vertices[j][1];
        var az = _vertices[j][2] + offset.y;

        var c1 = _colour[j];

        vertices[lastIndex * 3 + 0] = ax;
        vertices[lastIndex * 3 + 1] = ay;
        vertices[lastIndex * 3 + 2] = az;

        colours[lastIndex * 3 + 0] = c1[0];
        colours[lastIndex * 3 + 1] = c1[1];
        colours[lastIndex * 3 + 2] = c1[2];

        if (pickingIds) {
          pickingIds[lastIndex] = _pickingId;
        }

        lastIndex++;
      }
    }

    // itemSize = 3 because there are 3 values (components) per vertex
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));

    if (pickingIds) {
      geometry.setAttribute('pickingId', new THREE.BufferAttribute(pickingIds, 1));
    }

    geometry.computeBoundingBox();

    return geometry;
  };

  // TODO: Make picking IDs optional
  var createGeometry = function(attributes, offset) {
    var geometry = new THREE.BufferGeometry();

    // Three components per vertex per face (3 x 3 = 9)
    var vertices = new Float32Array(attributes.facesCount * 9);
    var normals = new Float32Array(attributes.facesCount * 9);
    var colours = new Float32Array(attributes.facesCount * 9);

    var pickingIds;
    if (attributes.pickingIds) {
      // One component per vertex per face (1 x 3 = 3)
      pickingIds = new Float32Array(attributes.facesCount * 3);
    }

    var pA = new THREE.Vector3();
    var pB = new THREE.Vector3();
    var pC = new THREE.Vector3();

    var cb = new THREE.Vector3();
    var ab = new THREE.Vector3();

    var index;
    var _faces;
    var _vertices;
    var _colour;
    var _pickingId;
    var lastIndex = 0;
    for (var i = 0; i < attributes.faces.length; i++) {
      _faces = attributes.faces[i];
      _vertices = attributes.vertices[i];
      _colour = attributes.colours[i];

      if (pickingIds) {
        _pickingId = attributes.pickingIds[i];
      }

      for (var j = 0; j < _faces.length; j++) {
        // Array of vertex indexes for the face
        index = _faces[j][0];

        var ax = _vertices[index][0] + offset.x;
        var ay = _vertices[index][1];
        var az = _vertices[index][2] + offset.y;

        var c1 = _colour[j][0];

        index = _faces[j][1];

        var bx = _vertices[index][0] + offset.x;
        var by = _vertices[index][1];
        var bz = _vertices[index][2] + offset.y;

        var c2 = _colour[j][1];

        index = _faces[j][2];

        var cx = _vertices[index][0] + offset.x;
        var cy = _vertices[index][1];
        var cz = _vertices[index][2] + offset.y;

        var c3 = _colour[j][2];

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

        normals[lastIndex * 9 + 0] = nx;
        normals[lastIndex * 9 + 1] = ny;
        normals[lastIndex * 9 + 2] = nz;

        colours[lastIndex * 9 + 0] = c1[0];
        colours[lastIndex * 9 + 1] = c1[1];
        colours[lastIndex * 9 + 2] = c1[2];

        vertices[lastIndex * 9 + 3] = bx;
        vertices[lastIndex * 9 + 4] = by;
        vertices[lastIndex * 9 + 5] = bz;

        normals[lastIndex * 9 + 3] = nx;
        normals[lastIndex * 9 + 4] = ny;
        normals[lastIndex * 9 + 5] = nz;

        colours[lastIndex * 9 + 3] = c2[0];
        colours[lastIndex * 9 + 4] = c2[1];
        colours[lastIndex * 9 + 5] = c2[2];

        vertices[lastIndex * 9 + 6] = cx;
        vertices[lastIndex * 9 + 7] = cy;
        vertices[lastIndex * 9 + 8] = cz;

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
    }

    // itemSize = 3 because there are 3 values (components) per vertex
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));

    if (pickingIds) {
      geometry.setAttribute('pickingId', new THREE.BufferAttribute(pickingIds, 1));
    }

    geometry.computeBoundingBox();

    return geometry;
  };

  return {
    mergeAttributes: mergeAttributes,
    createLineGeometry: createLineGeometry,
    createGeometry: createGeometry
  };
})();

// TODO: Move duplicated logic between geometry layrs into GeometryLayer

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
            _U += this._U_shift;
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
                    return noNew(coordinate[1], coordinate[0]);
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
                        this._offset = _point(0, 0);
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

// TODO: Move duplicated logic between geometry layrs into GeometryLayer

class PolylineLayer extends Layer {
    constructor(coordinates, options) {
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
                lineOpacity: 1,
                lineTransparent: false,
                lineColor: '#ffffff',
                lineWidth: 1,
                lineBlending: THREE.NormalBlending
            }
        };

        var _options = Object.assign({}, defaults, options);

        super(_options);

        // Return coordinates as array of lines so it's easy to support
        // MultiLineString features (a single line would be a MultiLineString with a
        // single line in the array)
        this._coordinates = (PolylineLayer.isSingle(coordinates)) ? [coordinates] : coordinates;

        // Polyline features are always flat (for now at least)
        this._flat = true;
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

    // Return center of polyline as a LatLon
    //
    // This is used for things like placing popups / UI elements on the layer
    //
    // TODO: Find proper center position instead of returning first coordinate
    // SEE: https://github.com/Leaflet/Leaflet/blob/master/src/layer/vector/Polyline.js#L59
    getCenter() {
        return this._center;
    }

    // Return line bounds in geographic coordinates
    //
    // TODO: Implement getBounds()
    getBounds() {
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
            if (this._options.style.lineHeight) {
                height = this._world.metresToWorld(this._options.style.lineHeight, this._pointScale);
            }

            var colour = new THREE.Color();
            colour.set(this._options.style.lineColor);

            // For each line
            attributes = this._projectedCoordinates.map(_projectedCoordinates => {
                var _vertices = [];
                var _colours = [];

                // Connect coordinate with the next to make a pair
                //
                // LineSegments requires pairs of vertices so repeat the last point if
                // there's an odd number of vertices
                var nextCoord;
                _projectedCoordinates.forEach((coordinate, index) => {
                    _colours.push([colour.r, colour.g, colour.b]);
                    _vertices.push([coordinate.x, height, coordinate.y]);

                    nextCoord = (_projectedCoordinates[index + 1]) ? _projectedCoordinates[index + 1] : coordinate;

                    _colours.push([colour.r, colour.g, colour.b]);
                    _vertices.push([nextCoord.x, height, nextCoord.y]);
                });

                var line = {
                    vertices: _vertices,
                    colours: _colours,
                    verticesCount: _vertices.length
                };

                if (this._options.interactive && this._pickingId) {
                    // Inject picking ID
                    line.pickingId = this._pickingId;
                }

                // Convert line representation to proper attribute arrays
                return this._toAttributes(line);
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

        if (attributes.normals) {
            geometry.setAttribute('normal', new THREE.BufferAttribute(attributes.normals, 3));
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(attributes.colours, 3));

        if (attributes.pickingIds) {
            geometry.setAttribute('pickingId', new THREE.BufferAttribute(attributes.pickingIds, 1));
        }

        geometry.computeBoundingBox();

        var style = this._options.style;
        var material;

        if (this._options.material && this._options.material instanceof THREE.Material) {
            material = this._options.material;
        } else {
            material = new THREE.LineBasicMaterial({
                vertexColors: THREE.VertexColors,
                linewidth: style.lineWidth,
                transparent: style.lineTransparent,
                opacity: style.lineOpacity,
                blending: style.lineBlending
            });
        }

        var mesh;

        // Pass mesh through callback, if defined
        if (typeof this._options.onMesh === 'function') {
            mesh = this._options.onMesh(geometry, material);
        } else {
            mesh = new THREE.LineSegments(geometry, material);

            if (style.lineRenderOrder !== undefined) {
                material.depthWrite = false;
                mesh.renderOrder = style.lineRenderOrder;
            }

            mesh.castShadow = true;
            // mesh.receiveShadow = true;
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

        this._center = this._coordinates[0][0];
    }

    // Recursively convert input coordinates into LatLon objects
    //
    // Calculate geographic bounds at the same time
    //
    // TODO: Calculate geographic bounds
    _convertCoordinates(coordinates) {
        return coordinates.map(_coordinates => {
            return _coordinates.map(coordinate => {
                return noNew(coordinate[1], coordinate[0]);
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
            return _coordinates.map(latlon => {
                point = this._world.latLonToPoint(latlon);

                // TODO: Is offset ever being used or needed?
                if (!this._offset) {
                    this._offset = _point(0, 0);
                    this._offset.x = -1 * point.x;
                    this._offset.y = -1 * point.y;

                    this._pointScale = World.pointScale(latlon);
                }

                return point;
            });
        });
    }

    // Transform line representation into attribute arrays that can be used by
    // THREE.BufferGeometry
    //
    // TODO: Can this be simplified? It's messy and huge
    _toAttributes(line) {
        // Three components per vertex
        var vertices = new Float32Array(line.verticesCount * 3);
        var colours = new Float32Array(line.verticesCount * 3);

        var pickingIds;
        if (line.pickingId) {
            // One component per vertex
            pickingIds = new Float32Array(line.verticesCount);
        }

        var _vertices = line.vertices;
        var _colour = line.colours;

        var normals;
        var _normals;
        if (line.normals) {
            normals = new Float32Array(line.verticesCount * 3);
            _normals = line.normals;
        }

        var _pickingId;
        if (pickingIds) {
            _pickingId = line.pickingId;
        }

        var lastIndex = 0;

        for (var i = 0; i < _vertices.length; i++) {
            var ax = _vertices[i][0];
            var ay = _vertices[i][1];
            var az = _vertices[i][2];

            var nx;
            var ny;
            var nz;
            if (_normals) {
                nx = _normals[i][0];
                ny = _normals[i][1];
                nz = _normals[i][2];
            }

            var c1 = _colour[i];

            vertices[lastIndex * 3 + 0] = ax;
            vertices[lastIndex * 3 + 1] = ay;
            vertices[lastIndex * 3 + 2] = az;

            if (normals) {
                normals[lastIndex * 3 + 0] = nx;
                normals[lastIndex * 3 + 1] = ny;
                normals[lastIndex * 3 + 2] = nz;
            }

            colours[lastIndex * 3 + 0] = c1[0];
            colours[lastIndex * 3 + 1] = c1[1];
            colours[lastIndex * 3 + 2] = c1[2];

            if (pickingIds) {
                pickingIds[lastIndex] = _pickingId;
            }

            lastIndex++;
        }

        var attributes = {
            vertices: vertices,
            colours: colours
        };

        if (normals) {
            attributes.normals = normals;
        }

        if (pickingIds) {
            attributes.pickingIds = pickingIds;
        }

        return attributes;
    }

    // Returns true if the line is flat (has no height)
    isFlat() {
        return this._flat;
    }

    // Returns true if coordinates refer to a single geometry
    //
    // For example, not coordinates for a MultiLineString GeoJSON feature
    static isSingle(coordinates) {
        return !Array.isArray(coordinates[0][0]);
    }

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

// TODO: Move duplicated logic between geometry layrs into GeometryLayer

class PointLayer extends Layer {
    constructor(coordinates, options) {
        var defaults = {
            output: true,
            interactive: false,
            // THREE.Geometry or THREE.BufferGeometry to use for point output
            geometry: null,
            // Custom material override
            //
            // TODO: Should this be in the style object?
            material: null,
            onMesh: null,
            // This default style is separate to Util.GeoJSON.defaultStyle
            style: {
                pointColor: '#ff0000'
            }
        };

        var _options = Object.assign({}, defaults, options);

        super(_options);

        // Return coordinates as array of points so it's easy to support
        // MultiPoint features (a single point would be a MultiPoint with a
        // single point in the array)
        this._coordinates = (PointLayer.isSingle(coordinates)) ? [coordinates] : coordinates;

        // Point features are always flat (for now at least)
        //
        // This won't always be the case once custom point objects / meshes are
        // added
        this._flat = true;
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

    // Return center of point as a LatLon
    //
    // This is used for things like placing popups / UI elements on the layer
    getCenter() {
        return this._center;
    }

    // Return point bounds in geographic coordinates
    //
    // While not useful for single points, it could be useful for MultiPoint
    //
    // TODO: Implement getBounds()
    getBounds() {
    }

    // Create and store reference to THREE.BufferAttribute data for this layer
    _setBufferAttributes() {
        var height = 0;

        // Convert height into world units
        if (this._options.style.pointHeight) {
            height = this._world(this._options.style.pointHeight, this._pointScale);
        }

        var colour = new THREE.Color();
        colour.set(this._options.style.pointColor);

        var geometry;

        // Use default geometry if none has been provided or the provided geometry
        // isn't valid
        if (!this._options.geometry || (!this._options.geometry instanceof THREE.Geometry || !this._options.geometry instanceof THREE.BufferGeometry)) {
            // Debug geometry for points is a thin bar
            //
            // TODO: Allow point geometry to be customised / overridden
            var geometryWidth = this._world.metresToWorld(25, this._pointScale);
            var geometryHeight = this._world.metresToWorld(200, this._pointScale);
            var _geometry = new THREE.BoxGeometry(geometryWidth, geometryHeight, geometryWidth);

            // Shift geometry up so it sits on the ground
            _geometry.translate(0, geometryHeight * 0.5, 0);

            // Pull attributes out of debug geometry
            geometry = new THREE.BufferGeometry().fromGeometry(_geometry);
        } else {
            if (this._options.geometry instanceof THREE.BufferGeometry) {
                geometry = this._options.geometry;
            } else {
                geometry = new THREE.BufferGeometry().fromGeometry(this._options.geometry);
            }
        }

        // For each point
        var attributes = this._projectedCoordinates.map(coordinate => {
            var _vertices = [];
            var _normals = [];
            var _colours = [];

            var _geometry = geometry.clone();

            _geometry.translate(coordinate.x, height, coordinate.y);

            var _vertices = _geometry.attributes.position.clone().array;
            var _normals = _geometry.attributes.normal.clone().array;
            var _colours = _geometry.attributes.color.clone().array;

            for (var i = 0; i < _colours.length; i += 3) {
                _colours[i] = colour.r;
                _colours[i + 1] = colour.g;
                _colours[i + 2] = colour.b;
            }

            var _point = {
                vertices: _vertices,
                normals: _normals,
                colours: _colours
            };

            if (this._options.interactive && this._pickingId) {
                // Inject picking ID
                // point.pickingId = this._pickingId;
                _point.pickingIds = new Float32Array(_vertices.length / 3);
                for (var i = 0; i < _point.pickingIds.length; i++) {
                    _point.pickingIds[i] = this._pickingId;
                }
            }

            // Convert point representation to proper attribute arrays
            // return this._toAttributes(_point);
            return _point;
        });

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
            material = new THREE.MeshBasicMaterial({
                vertexColors: THREE.VertexColors
                // side: THREE.BackSide
            });
        }

        var mesh;

        // Pass mesh through callback, if defined
        if (typeof this._options.onMesh === 'function') {
            mesh = this._options.onMesh(geometry, material);
        } else {
            mesh = new THREE.Mesh(geometry, material);

            mesh.castShadow = true;
            // mesh.receiveShadow = true;
        }

        if (this._options.interactive && this._pickingMesh) {
            material = new PickingMaterial();
            // material.side = THREE.BackSide;

            var pickingMesh = new THREE.Mesh(geometry, material);
            this._pickingMesh.add(pickingMesh);
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

        this._center = this._coordinates;
    }

    // Recursively convert input coordinates into LatLon objects
    //
    // Calculate geographic bounds at the same time
    //
    // TODO: Calculate geographic bounds
    _convertCoordinates(coordinates) {
        return coordinates.map(coordinate => {
            return noNew(coordinate[1], coordinate[0]);
        });
    }

    // Recursively project coordinates into world positions
    //
    // Calculate world bounds, offset and pointScale at the same time
    //
    // TODO: Calculate world bounds
    _projectCoordinates() {
        var _point$1;
        return this._coordinates.map(latlon => {
            _point$1 = this._world.latLonToPoint(latlon);

            // TODO: Is offset ever being used or needed?
            if (!this._offset) {
                this._offset = _point(0, 0);
                this._offset.x = -1 * _point$1.x;
                this._offset.y = -1 * _point$1.y;

                this._pointScale = World.pointScale(latlon);
            }

            return _point$1;
        });
    }

    // Transform line representation into attribute arrays that can be used by
    // THREE.BufferGeometry
    //
    // TODO: Can this be simplified? It's messy and huge
    _toAttributes(line) {
        // Three components per vertex
        var vertices = new Float32Array(line.verticesCount * 3);
        var colours = new Float32Array(line.verticesCount * 3);

        var pickingIds;
        if (line.pickingId) {
            // One component per vertex
            pickingIds = new Float32Array(line.verticesCount);
        }

        var _vertices = line.vertices;
        var _colour = line.colours;

        var _pickingId;
        if (pickingIds) {
            _pickingId = line.pickingId;
        }

        var lastIndex = 0;

        for (var i = 0; i < _vertices.length; i++) {
            var ax = _vertices[i][0];
            var ay = _vertices[i][1];
            var az = _vertices[i][2];

            var c1 = _colour[i];

            vertices[lastIndex * 3 + 0] = ax;
            vertices[lastIndex * 3 + 1] = ay;
            vertices[lastIndex * 3 + 2] = az;

            colours[lastIndex * 3 + 0] = c1[0];
            colours[lastIndex * 3 + 1] = c1[1];
            colours[lastIndex * 3 + 2] = c1[2];

            if (pickingIds) {
                pickingIds[lastIndex] = _pickingId;
            }

            lastIndex++;
        }

        var attributes = {
            vertices: vertices,
            colours: colours
        };

        if (pickingIds) {
            attributes.pickingIds = pickingIds;
        }

        return attributes;
    }

    // Returns true if the line is flat (has no height)
    isFlat() {
        return this._flat;
    }

    // Returns true if coordinates refer to a single geometry
    //
    // For example, not coordinates for a MultiPoint GeoJSON feature
    static isSingle(coordinates) {
        return !Array.isArray(coordinates[0]);
    }

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

class GeoJSONLayer extends LayerGroup {

    constructor(geojson, options, tile) {

        var defaults = {
            style: GeoJSON.defaultStyle,
            keepFeatures: true,
            filter: null,
            onEachFeature: null,
        };

        var _options = Object.assign({}, defaults, options);

        if (typeof options.style === 'function') {
            _options.style = options.style;
        } else {
            _options.style = Object.assign({}, defaults.style, options.style);
        }

        super(_options, tile);

        this._geojson = geojson;

    }

    init() {

        //console.log('GeoJSONLayer init');

        // Request data from URL if needed
        if (typeof this._geojson === 'string') {
            this._requestData(this._geojson);
        } else {
            // Process and add GeoJSON to layer
            this._processData(this._geojson);
        }
    }

    _requestData(url) {

        this._loader = new THREE.FileLoader();
        this._loader.crossOrigin = '';

        var thisRef = this;

//load a text file and output the result to the console
        this._loader.load(
            // resource URL
            url,

            // onLoad callback
            function (data) {
                // output the text to the console
                thisRef._loader = null;
                thisRef._processData(JSON.parse(data));
            },

            // onProgress callback
            function (xhr) {
                //console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },

            // onError callback
            function (err) {
                console.error('An error happened', err);
                thisRef._loader = null;
            }
        );

    }

    _processData(data) {
        // Collects features into a single FeatureCollection
        //
        // Also converts TopoJSON to GeoJSON if instructed
        this._geojson = GeoJSON.collectFeatures(data, this._options.topojson);

        // TODO: Check that GeoJSON is valid / usable

        var features = this._geojson.features;

        // Run filter, if provided
        if (this._options.filter) {
            features = this._geojson.features.filter(this._options.filter);
        }

        var defaults = {};

        // Assume that a style won't be set per feature
        var style = this._options.style;

        var options;
        features.forEach(feature => {
            // Get per-feature style object, if provided
            if (typeof this._options.style === 'function') {
                style = Object.assign({}, GeoJSON.defaultStyle, this._options.style(feature));
            }

            options = Object.assign({}, defaults, {
                style: style
            });

            var layer = this._featureToLayer(feature, options);

            if (!layer) {
                return;
            }

            // Sometimes you don't want to store a reference to the feature
            //
            // For example, to save memory when being used by tile layers
            if (this._options.keepFeatures) {
                layer.feature = feature;
            }

            // If defined, call a function for each feature
            //
            // This is commonly used for adding event listeners from the user script
            if (this._options.onEachFeature) {
                this._options.onEachFeature(feature, layer);
            }

            this.addLayer(layer);
        });

        // If merging layers do that now, otherwise skip as the geometry layers
        // should have already outputted themselves
        // From here on we can assume that we want to merge the layers

        var polygonAttributes = [];
        var polygonFlat = true;

        var polylineAttributes = [];
        var pointAttributes = [];

        this._layers.forEach(layer => {
            if (layer instanceof PolygonLayer) {
                polygonAttributes.push(layer.getBufferAttributes());

                if (polygonFlat && !layer.isFlat()) {
                    polygonFlat = false;
                }
            } else if (layer instanceof PolylineLayer) {
                polylineAttributes.push(layer.getBufferAttributes());
            } else if (layer instanceof PointLayer) {
                pointAttributes.push(layer.getBufferAttributes());
            }
        });

        if (polygonAttributes.length > 0) {
            var mergedPolygonAttributes = Buffer.mergeAttributes(polygonAttributes);
            this._setPolygonMesh(mergedPolygonAttributes, polygonFlat);
            this.add(this._polygonMesh);
        }

        if (polylineAttributes.length > 0) {
            var mergedPolylineAttributes = Buffer.mergeAttributes(polylineAttributes);
            this._setPolylineMesh(mergedPolylineAttributes);
            this.add(this._polylineMesh);
        }

        if (pointAttributes.length > 0) {
            var mergedPointAttributes = Buffer.mergeAttributes(pointAttributes);
            this._setPointMesh(mergedPointAttributes);
            this.add(this._pointMesh);
        }

        // Clean up layers
        //
        // TODO: Are there ever situations where the unmerged buffer attributes
        // and coordinates would still be required?
        this._layers.forEach(layer => {
            layer.clearBufferAttributes();
            layer.clearCoordinates();
        });
    }

    // Create and store mesh from buffer attributes
    //
    // TODO: De-dupe this from the individual mesh creation logic within each
    // geometry layer (materials, settings, etc)
    //
    // Could make this an abstract method for each geometry layer
    _setPolygonMesh(attributes, flat) {
        var geometry = new THREE.BufferGeometry();

        // itemSize = 3 because there are 3 values (components) per vertex
        geometry.setAttribute('position', new THREE.BufferAttribute(attributes.vertices, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(attributes.normals, 3));

        if (this._isTile) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(attributes.uvs, 2));
        } else {
            geometry.setAttribute('color', new THREE.BufferAttribute(attributes.colours, 3));
        }

        if (attributes.pickingIds) {
            geometry.setAttribute('pickingId', new THREE.BufferAttribute(attributes.pickingIds, 1));
        }

        geometry.computeBoundingBox();

        // TODO: Make this work when style is a function per feature
        var style = (typeof this._options.style === 'function') ? this._options.style(this._geojson.features[0]) : this._options.style;
        style = Object.assign({}, GeoJSON.defaultStyle, style);

        var material;
        const color = style.color;

        if (this._isTile) {

            material = this._tile.material;

        } else if (this._options.polygonMaterial && this._options.polygonMaterial instanceof THREE.Material) {
            material = this._options.polygonMaterial;
        } else {
            material = new THREE.MeshBasicMaterial({
                vertexColors: THREE.VertexColors,
                side: THREE.DoubleSide,
                transparent: style.transparent,
                opacity: style.opacity,
                blending: style.blending,
                flatShading: true,
                wireframe: false
            });
        }

        var mesh;

        // Pass mesh through callback, if defined
        if (typeof this._options.onPolygonMesh === 'function') {
            mesh = this._options.onPolygonMesh(geometry, material);
        } else {
            mesh = new THREE.Mesh(geometry, material);
            //geometry = new THREE.EdgesGeometry( geometry );
            //material = new THREE.LineBasicMaterial( { color: 0xffffff } );

            //mesh = new THREE.LineSegments( geometry, material );

            //mesh.castShadow = true;
            //mesh.receiveShadow = true;
        }

        if (flat) {
            if (material) {
                material.depthWrite = false;
            }
            mesh.renderOrder = 1;
        }

        if (this._options.interactive && this._pickingMesh) {
            material = new PickingMaterial();
            material.side = THREE.BackSide;

            var pickingMesh = new THREE.Mesh(geometry, material);
            this._pickingMesh.add(pickingMesh);
        }

        this._polygonMesh = mesh;
    }

    _setPolylineMesh(attributes) {
        var geometry = new THREE.BufferGeometry();

        // itemSize = 3 because there are 3 values (components) per vertex
        geometry.addAttribute('position', new THREE.BufferAttribute(attributes.vertices, 3));

        if (attributes.normals) {
            geometry.addAttribute('normal', new THREE.BufferAttribute(attributes.normals, 3));
        }

        geometry.addAttribute('color', new THREE.BufferAttribute(attributes.colours, 3));

        if (attributes.pickingIds) {
            geometry.addAttribute('pickingId', new THREE.BufferAttribute(attributes.pickingIds, 1));
        }

        geometry.computeBoundingBox();

        // TODO: Make this work when style is a function per feature
        var style = (typeof this._options.style === 'function') ? this._options.style(this._geojson.features[0]) : this._options.style;
        style = Object.assign({}, GeoJSON.defaultStyle, style);

        var material;
        if (this._options.polylineMaterial && this._options.polylineMaterial instanceof THREE.Material) {
            material = this._options.polylineMaterial;
        } else {
            material = new THREE.LineBasicMaterial({
                vertexColors: THREE.VertexColors,
                linewidth: style.lineWidth,
                transparent: style.lineTransparent,
                opacity: style.lineOpacity,
                blending: style.lineBlending
            });
        }

        var mesh;

        // Pass mesh through callback, if defined
        if (typeof this._options.onPolylineMesh === 'function') {
            mesh = this._options.onPolylineMesh(geometry, material);
        } else {
            mesh = new THREE.LineSegments(geometry, material);

            if (style.lineRenderOrder !== undefined) {
                material.depthWrite = false;
                mesh.renderOrder = style.lineRenderOrder;
            }

            mesh.castShadow = true;
            // mesh.receiveShadow = true;
        }

        // TODO: Allow this to be overridden, or copy mesh instead of creating a new
        // one just for picking
        if (this._options.interactive && this._pickingMesh) {
            material = new PickingMaterial();
            // material.side = THREE.BackSide;

            // Make the line wider / easier to pick
            material.linewidth = style.lineWidth + material.linePadding;

            var pickingMesh = new THREE.LineSegments(geometry, material);
            this._pickingMesh.add(pickingMesh);
        }

        this._polylineMesh = mesh;
    }

    _setPointMesh(attributes) {
        var geometry = new THREE.BufferGeometry();

        // itemSize = 3 because there are 3 values (components) per vertex
        geometry.addAttribute('position', new THREE.BufferAttribute(attributes.vertices, 3));
        geometry.addAttribute('normal', new THREE.BufferAttribute(attributes.normals, 3));
        geometry.addAttribute('color', new THREE.BufferAttribute(attributes.colours, 3));


        if (attributes.pickingIds) {
            geometry.addAttribute('pickingId', new THREE.BufferAttribute(attributes.pickingIds, 1));
        }

        geometry.computeBoundingBox();

        var material;
        if (this._options.pointMaterial && this._options.pointMaterial instanceof THREE.Material) {
            material = this._options.pointMaterial;
        } else {
            material = new THREE.MeshPhongMaterial({
                vertexColors: THREE.VertexColors
                // side: THREE.BackSide
            });
        }

        var mesh;

        // Pass mesh callback, if defined
        if (typeof this._options.onPointMesh === 'function') {
            mesh = this._options.onPointMesh(geometry, material);
        } else {
            mesh = new THREE.Mesh(geometry, material);
        }

        if (this._options.interactive && this._pickingMesh) {
            material = new PickingMaterial();
            // material.side = THREE.BackSide;

            var pickingMesh = new THREE.Mesh(geometry, material);
            this._pickingMesh.add(pickingMesh);
        }

        this._pointMesh = mesh;
    }

    // TODO: Support all GeoJSON geometry types
    _featureToLayer(feature, options) {
        var geometry = feature.geometry;
        var coordinates = (geometry.coordinates) ? geometry.coordinates : null;

        if (!coordinates || !geometry) {
            return;
        }


        let min_height = feature.properties.min_height;

        if (!min_height) {
            min_height = feature.properties.minHeight;
        }

        if (min_height === undefined) {
            min_height = 0;
        }

        if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
            // Get material instance to use for polygon, if provided
            if (typeof this._options.polygonMaterial === 'function') {
                //options.geometry = this._options.polygonMaterial(feature);
                options.material = this._options.polygonMaterial(feature);
            }

            if (typeof this._options.onPolygonMesh === 'function') {
                options.onMesh = this._options.onPolygonMesh;
            }

            // Pass onBufferAttributes callback, if defined
            if (typeof this._options.onPolygonBufferAttributes === 'function') {
                options.onBufferAttributes = this._options.onPolygonBufferAttributes;
            }

            if (feature.properties.id === -3427805) {
                options.style.dump = true;
            }

            options.style.min_height = min_height;

            if (this._isTile) {
                return new PolygonLayer(coordinates, options, this._tile);
            }
            return new PolygonLayer(coordinates, options);
        }

        if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
            // Get material instance to use for line, if provided
            if (typeof this._options.lineMaterial === 'function') {
                options.geometry = this._options.lineMaterial(feature);
            }

            if (typeof this._options.onPolylineMesh === 'function') {
                options.onMesh = this._options.onPolylineMesh;
            }

            // Pass onBufferAttributes callback, if defined
            if (typeof this._options.onPolylineBufferAttributes === 'function') {
                options.onBufferAttributes = this._options.onPolylineBufferAttributes;
            }

            //return new PolylineLayer(coordinates, options);
        }

        if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
            // Get geometry object to use for point, if provided
            if (typeof this._options.pointGeometry === 'function') {
                options.geometry = this._options.pointGeometry(feature);
            }

            // Get material instance to use for point, if provided
            if (typeof this._options.pointMaterial === 'function') {
                options.geometry = this._options.pointMaterial(feature);
            }

            if (typeof this._options.onPointMesh === 'function') {
                options.onMesh = this._options.onPointMesh;
            }

            //return new PointLayer(coordinates, options);
        }
    }
}

var noNew$2 = function (geojson, options, tile) {
    return new GeoJSONLayer(geojson, options, tile);
};

class FlatMapLayer extends LayerGroup {
    constructor(mapURL, options) {
        var _defaultStyle = {
            color: '#ffffff',
            transparent: false,
            opacity: 1,
            blending: THREE.NormalBlending,
        };

        var defaults = {
            style: _defaultStyle,
            keepFeatures: true,
            filter: null,
            onEachFeature: null,
        };

        var _options = Object.assign({}, defaults, options);

        if (typeof options.style === 'function') {
            _options.style = options.style;
        } else {
            _options.style = Object.assign({}, defaults.style, options.style);
        }

        super(_options);

        this._mapURL = mapURL;
    }


    init() {

        console.log('Flat map Layer init');

        this.createFarPlane(this._mapURL, this._options.farPlane);

    }


    createFarPlane(mapURL, far_plane_size) {

        var planeGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);

        var material = new THREE.MeshBasicMaterial({
            color: '#9aff7e',
            side: THREE.FrontSide
        });

        const depth = 0.02;

        planeGeometry.vertices[0].x = -far_plane_size;
        planeGeometry.vertices[0].y = -far_plane_size;
        planeGeometry.vertices[0].z = depth;

        planeGeometry.vertices[1].x = far_plane_size;
        planeGeometry.vertices[1].y = -far_plane_size;
        planeGeometry.vertices[1].z = depth;

        planeGeometry.vertices[2].x = -far_plane_size;
        planeGeometry.vertices[2].y = far_plane_size;
        planeGeometry.vertices[2].z = depth;

        planeGeometry.vertices[3].x = far_plane_size;
        planeGeometry.vertices[3].y = far_plane_size;
        planeGeometry.vertices[3].z = depth;

        var plane = new THREE.Mesh(planeGeometry, material);
        //plane.position.set(0, -0.3, 0);
        plane.rotation.x = Math.PI / 2;


        this.add(plane);
    }
}

var noNew$3 = function (mapURL, options) {
    return new FlatMapLayer(mapURL, options);
};

const OBJECTIVITY = {
    version: '0.1',

    //Public API
    World: World,
    world: noNew$1,
    GeoJSONLayer: GeoJSONLayer,
    geoJSONLayer: noNew$2,
    FlatMapLayer: FlatMapLayer,
    flatMapLayer: noNew$3
};

export default OBJECTIVITY;
