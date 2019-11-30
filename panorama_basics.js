var renderer, scene;

// Converts from degrees to radians.
Math.radians = function (degrees) {
    return degrees * Math.PI / 180;
};

// Converts from radians to degrees.
Math.degrees = function (radians) {
    return radians * 180 / Math.PI;
};

var center_coords = [55.7450991,37.6036949];//[55.745095, 37.603688];

var objectivityCity = ObjectivityCity.world('Moscow',
    {
        postprocessing: false,
        scale: 0.25
    }
);

objectivityCity.setCoordinates(center_coords);

ymaps.ready(function () {


    ymaps.panorama.locate(center_coords).done(
        function (panoramas) {

            for (const panorama of panoramas) {

                const panorama_center_position = panorama.getPosition();//_position;

                console.log('Position : ' + panorama_center_position);

                let panoramaPoint = objectivityCity.latLonToPoint({
                    lon: panorama_center_position[1],
                    lat: panorama_center_position[0]
                });

                console.log('Panorama point : ' + JSON.stringify(panoramaPoint));

                const angularBBox = panorama.getAngularBBox();

                console.log('angularBBox : ' + angularBBox);

                const verticalAngle = angularBBox[0] - angularBBox[2];

                let startAngle = angularBBox[1];

                while(startAngle > 2* Math.PI){
                    startAngle = startAngle - 2* Math.PI;
                }

                console.log('startAngle : ' + startAngle);

                console.log('Vert angle : ' + Math.degrees(verticalAngle));

                const tileImageSize = panorama.getTileSize();

                console.log('getTileSize : ' + JSON.stringify(tileImageSize));

                for (const tileLevel of panorama.getTileLevels()) {

                    if (tileLevel._z !== 2) {
                        continue;
                    }

                    const imageSize = tileLevel.getImageSize();
                    console.log('Tile Size : ' + JSON.stringify(imageSize));
                    const imageWidth = imageSize[0];
                    const imageWidthInTiles = Math.ceil(imageWidth / tileImageSize[0]);
                    const imageHeight = imageSize[1];
                    const imageHeightInTiles = Math.ceil(imageHeight / tileImageSize[1]);

                    const fullImageRatio = 1 / (1 - ((Math.PI - verticalAngle) / Math.PI));

                    console.log('fullImageRatio : ' + fullImageRatio);

                    const fullImageHeight = Math.round(imageHeight * fullImageRatio);

                    const canvasTile = new CanvasTile(
                        tileImageSize[0],
                        tileImageSize[1],
                        imageWidthInTiles * tileImageSize[0],
                        fullImageHeight
                    );

                    for (var x = 0; x < imageWidthInTiles; x++) {
                        for (var y = 0; y < imageHeightInTiles; y++) {
                            //console.log('Tile URL : ' + tileLevel.getTileUrl(x, y));

                            canvasTile.addTile(x, y, tileLevel.getTileUrl(x, y))

                        }
                    }

                    document.body.appendChild(canvasTile.getCanvas); // adds the canvas to the body element

                }

            }


        },
        function (error) {
            // Если что-то пошло не так, сообщим об этом пользователю.
            alert(error.message);
        }
    );


});

function init() {

    var NEAR = 1, FAR = 4096;
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, NEAR, FAR);
    scene = new THREE.Scene();

    renderer = new THREE.WebGLRenderer({antialias: true});

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    document.body.appendChild(renderer.domElement);
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    renderer.gammaInput = true;
    renderer.gammaOutput = true;

    window.addEventListener('resize', onWindowResize, false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    try {
        renderer.render(scene, camera);
    } catch (e) {

    }
    requestAnimationFrame(animate);
}
