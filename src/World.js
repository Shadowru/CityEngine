import Geo from './geo/Geo';
import {point as Point} from './geo/Point';
import {latLon as LatLon} from './geo/LatLon';
import THREE from "three";

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
        return Geo.latLonToPoint(LatLon(latlon));
    }

    // Transform world point to geographic coordinate
    //
    // This doesn't take into account the origin offset
    //
    // For example, this takes a point relative to the origin point of the
    // projection (not the world) and returns a geographic coordinate
    static unproject(point) {
        return Geo.pointToLatLon(Point(point));
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
        var projectedPoint = World.project(LatLon(latlon));
        return(this.rescalePoint(projectedPoint._subtract(this._originPoint)));
    }

    // Takes into account the origin offset
    //
    // For example, this takes a point relative to the three.js / 3D origin (0,0)
    // and returns the exact geographic coordinate at that point
    pointToLatLon(point) {
        var projectedPoint = Point(point).add(this._originPoint);
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

export default World;

var noNew = function (domId, options) {
    return new World(domId, options);
};

// Initialise without requiring new keyword
export {noNew as world};
