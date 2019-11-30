class CanvasTile {
    constructor(tileWidth, tileHeight, width, height) {
        this._x = -1;
        this._y = -1;
        this._w = width;
        this._h = height;

        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;

        //create the canvas object here
        var can2 = document.createElement('canvas');
        can2.width = this._w;
        can2.height = this._h;
        this._cvsHdl = can2;
        this._ctx = can2.getContext('2d');

        this._ctx.fillStyle = "blue";
        this._ctx.fillRect(0, 0, this._w, this._h);

        this._isFree = true;
    };

    addTile(x, y, url) {

        (function (x, y, url, ctx) {
            var img = new Image;
            img.onload = function () {
                ctx.drawImage(img, x, y); // Or at whatever offset you like
            };
            img.src = url;
        })(x * this._tileWidth, y * this._tileHeight, url, this._ctx);
    }

    get getCanvas() {
        return this._cvsHdl;
    }
}

