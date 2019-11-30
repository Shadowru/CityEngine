import Layer from './Layer';

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

export default LayerGroup;
