import LayerGroup from "./LayerGroup";
import THREE from "three";

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

export default FlatMapLayer;

var noNew = function (mapURL, options) {
    return new FlatMapLayer(mapURL, options);
};

// Initialise without requiring new keyword
export {noNew as flatMapLayer};

