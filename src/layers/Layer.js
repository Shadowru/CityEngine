import THREE from 'three';

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

        if (this._isTile) {

        } else {
            console.log('isTile : ' + this._isTile)
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

export default Layer;

var noNew = function (options, tile) {
    return new Layer(options, tile);
};

export {noNew as layer};
