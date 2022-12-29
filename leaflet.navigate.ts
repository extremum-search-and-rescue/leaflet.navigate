namespace L {
    export interface Map extends L.Evented {
        navigate: L.Control.NavigateTo
    }
    export interface MapOptions {
        navigateControl: boolean;
    }
    export namespace Control {

        export class DestinationMarkerOptions implements L.IContextMenuOptions {
            className: string = 'leaflet-control-navigate-marker'
            color: string = '#fff'
            fillColor: string = 'red'
            fillOpacity: number = 1
            weight: number = 3
            opacity: number = 1
            radius: number = 9
            contextmenu: boolean = true
            contextmenuInheritItems: boolean = false
            contextmenuItems: Array<L.ContextmenuItemOptions> = [
                {
                    disabled: false,
                    text: "Остановить навигацию",
                    callback: (e) => {
                        map.fire('navigate:stop');
                    }
            }]
        }
        export class DestinationHeadingStyleOptions {
            fillColor: string = 'red'
            fillOpacity: number = 1
            weight: number = 0
            color: string = '#fff'
            opacity: number = 1
            depth: string
        }
        export class DestinationLineOptions implements L.GisPolylineOptions {
            interactive: boolean = false
            color: string = 'red'
            dashArray: string = '1 5'
            width: number = 2
            noMeasurements: boolean = true
        }
        export class NavigateToOptions {
            position: L.ControlPosition = 'bottomcenter'
            destinationMarkerOptions: L.Control.DestinationMarkerOptions = new L.Control.DestinationMarkerOptions();
            _destinationHeadingStyle: L.Control.DestinationHeadingStyleOptions = new L.Control.DestinationHeadingStyleOptions();
            destinationLineOptions: L.Control.DestinationLineOptions = new L.Control.DestinationLineOptions();
        }

        export class NavigateTo extends L.Control {
            override options: NavigateToOptions
            navigating: boolean = false
            _container: HTMLDivElement = null
            _innerContainer: HTMLDivElement = null
            _location: L.LatLng = null
            _destination: L.LatLng = null
            _destinationMarker: null
            _destinationLine: L.Polyline<GeoJSON.LineString>
            _headingUpdateIntervalId: number = null
            _lastHeading: number = null
            _map: L.Map;

            constructor(options: L.Control.NavigateToOptions) {
                options = { ...new L.Control.NavigateToOptions(), ...options };
                super(options)
            }

            override onAdd(map: L.Map) {
                this._map = map;
                const container = this._container = document.createElement('div');
                container.style.display = 'none';
                const innerContainer = this._innerContainer = document.createElement('div');
                innerContainer.style.display = 'flex';
                innerContainer.style.justifyContent = 'center';
                L.DomUtil.addClass(innerContainer, 'leaflet-navigate-container');
                container.appendChild(innerContainer);

                {
                    const arrowSpan = document.createElement('span');
                    arrowSpan.id = 'headingArrow';
                    arrowSpan.style.width = this.options._destinationHeadingStyle.depth;
                    arrowSpan.style.height = this.options._destinationHeadingStyle.depth;
                    L.DomUtil.addClass(arrowSpan, 'leaflet-navigate-arrow');

                    innerContainer.appendChild(arrowSpan);
                }

                const valuesContainer = document.createElement('div');
                valuesContainer.style.display = 'flex';
                valuesContainer.style.flexDirection = 'column';

                {
                    const distanceContainer = document.createElement('div');
                    distanceContainer.style.display = 'flex';
                    distanceContainer.style.flexDirection = 'row';

                    const distanceValue = document.createElement('span');
                    distanceValue.id = 'distanceValue';
                    L.DomUtil.addClass(distanceValue, "leaflet-navigate-value gis-themeaware");
                    distanceContainer.appendChild(distanceValue);

                    const distanceUnits = document.createElement('span');
                    distanceUnits.id = 'distanceUnits';
                    L.DomUtil.addClass(distanceUnits, "leaflet-navigate-units gis-themeaware");
                    distanceContainer.appendChild(distanceUnits);
                    valuesContainer.appendChild(distanceContainer);
                }
                {
                    const courseContainer = document.createElement('div');
                    courseContainer.style.display = 'flex';
                    courseContainer.style.flexDirection = 'row';

                    const courseValue = document.createElement('span');
                    courseValue.id = 'courseValue';
                    L.DomUtil.addClass(courseValue, "leaflet-navigate-units gis-themeaware");
                    courseContainer.appendChild(courseValue);

                    const courseDiff = document.createElement('span');
                    courseDiff.id = 'courseDiff';
                    L.DomUtil.addClass(courseDiff, "leaflet-navigate-units gis-themeaware");
                    courseContainer.appendChild(courseDiff);
                    valuesContainer.appendChild(courseContainer);
                }

                innerContainer.appendChild(valuesContainer);
                map.on('locationfound', this._onLocationUpdate, this);
                map.on('navigate:start', this._onNavigateStart, this);
                map.on('navigate:stop', this._onNavigateStop, this);
                return container;
            }
            override onRemove(map: L.Map) {
                map.off('locationfound', this._onLocationUpdate, this);
                map.off('navigate:start', this._onNavigateStart, this);
                map.off('navigate:stop', this._onNavigateStop, this);
            }
            _onLocationUpdate(e: GeolocationCoordinates) {
                this._location = L.latLng(e.latitude, e.longitude, e.altitude);
                if (!this.navigating) return;

                this._updateControl();
            }
            _onNavigateStart(latlng: L.LatLng) {
                if (!this._map.locateEx) throw new Error('leaflet.navigate requires LocateEx control');
                if (this.navigating) this._onNavigateStop();

                const currentLocation = this._map.locateEx._event;
                if (currentLocation && currentLocation.latlng) {
                    this._location.lat = currentLocation.latlng.lat;
                    this._location.lng = currentLocation.latlng.lng;
                }

                this._destination = latlng;
                this.navigating = true;

                if (this._destinationMarker) {
                    this._map.removeLayer(this._destinationMarker);
                    this._destinationMarker = null;
                }
                if (this._destinationLine) {
                    this._map.removeLayer(this._destinationLine);
                    this._destinationLine = null;
                }
                this._destinationMarker = new this._map.locateEx.options.markerClass(
                    latlng, this.options.destinationMarkerOptions)
                    .addTo(this._map);

                this._updateControl();
                this._headingUpdateIntervalId = setInterval(() => this._updateCompass(), 200);
                //// uncomment for debugging on desktop
                //this._headingUpdateIntervalId = setInterval(() => {
                //    this._map.locateEx._compassHeading = this._map.locateEx._compassHeading > 360 ? 0 : this._map.locateEx._compassHeading + 3;
                //    this._updateCompass();
                //}, 200);
                this._container.style.display = 'block';
            }
            bearing(latlng1: L.LatLng, latlng2: L.LatLng): number {
                var rad = Math.PI / 180,
                    lat1 = latlng1.lat * rad,
                    lat2 = latlng2.lat * rad,
                    lon1 = latlng1.lng * rad,
                    lon2 = latlng2.lng * rad,
                    y = Math.sin(lon2 - lon1) * Math.cos(lat2),
                    x = Math.cos(lat1) * Math.sin(lat2) -
                        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
                return (Math.atan2(y, x) * 180 / Math.PI);
            }
            _onNavigateStop() {
                this.navigating = false;
                this._destination = null;
                this._map.off('locationfound', this._onLocationUpdate, this);
                if (this._destinationMarker) {
                    this._map.removeLayer(this._destinationMarker);
                    this._destinationMarker = null;
                }
                if (this._destinationLine) {
                    this._map.removeLayer(this._destinationLine);
                    this._destinationLine = null;
                }
                clearInterval(this._headingUpdateIntervalId);
                this._headingUpdateIntervalId = null;
                this._container.style.display = 'none';
            }

            _getIconSVG(heading: number, compassHeading: number) {
                const headingRotate = `translate(0,0) rotate(${heading} 24 24)`;
                const compassHeadingRotate = `rotate(${(360 - compassHeading) % 360} 24 24)`;
                const code = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 48 48" overflow="visible">` +
                    `<g transform="${compassHeadingRotate}">` +
                    `<path fill-rule="evenodd" clip-rule="evenodd" d="M42.59 5.83a26.68 26.68 0 0 0-.88-.88l-5.52 5.79a19.17 19.17 0 0 1 .61.61l5.79-5.52Zm0 35.88-5.79-5.52a19.17 19.17 0 0 1-.61.61l5.52 5.79a26.64 26.64 0 0 0 .88-.88Zm-36.76.88 5.52-5.79a18.77 18.77 0 0 1-.61-.61L4.95 41.7a26.48 26.48 0 0 0 .88.88Zm0-37.64 5.52 5.79a18.77 18.77 0 0 0-.61.61L4.95 5.83a26.52 26.52 0 0 1 .88-.88Z" fill="#fff"/>` +
                    `<path d="m25.37 6.84 1.68.54a3.78 3.78 0 0 1-1.29 2.09 3.7 3.7 0 0 1-2.28.68 3.7 3.7 0 0 1-2.81-1.17 4.48 4.48 0 0 1-1.1-3.2c0-1.43.37-2.54 1.1-3.33a3.8 3.8 0 0 1 2.92-1.19c1.05 0 1.9.31 2.56.94.39.36.68.89.88 1.58l-1.72.4a1.8 1.8 0 0 0-.64-1.05 1.81 1.81 0 0 0-1.17-.38c-.64 0-1.15.22-1.55.68-.4.46-.6 1.2-.6 2.22 0 1.09.2 1.86.6 2.32.38.46.89.7 1.51.7.47 0 .86-.15 1.2-.45.33-.29.56-.75.7-1.38Zm3.75 39.75H27.4V43H26a4.5 4.5 0 0 1-1.12 2.66c-.64.72-1.58 1.08-2.81 1.08a3.64 3.64 0 0 1-2.82-1.15 4.7 4.7 0 0 1-1.05-3.28c0-.93.15-1.73.45-2.39.3-.65.74-1.16 1.3-1.53a3.74 3.74 0 0 1 2.07-.54c.85 0 1.52.14 2.02.4.5.27.93.7 1.3 1.3.38.58.6 1.26.66 2.01h1.4V38h1.73v8.59Zm-4.86-4.3a3.7 3.7 0 0 0-.57-2.22 1.87 1.87 0 0 0-1.6-.77c-.7 0-1.24.26-1.59.77a4.1 4.1 0 0 0-.53 2.31c0 .99.2 1.7.61 2.16a2 2 0 0 0 1.57.7 1.9 1.9 0 0 0 1.52-.7c.4-.47.59-1.22.59-2.26ZM3.75 25.9l-.39 1.69c-1.4-.36-2.1-1.4-2.1-3.1 0-1 .23-1.77.67-2.28a2 2 0 0 1 1.56-.77c.41 0 .78.11 1.11.35a3 3 0 0 1 .87 1.05c.2-.57.47-1 .83-1.28s.8-.43 1.32-.43c.75 0 1.36.28 1.83.83.46.56.7 1.38.7 2.48 0 .9-.15 1.61-.45 2.13-.3.52-.86.91-1.68 1.17l-.52-1.59c.51-.16.85-.38 1-.65.15-.27.23-.6.23-1 0-.55-.12-.95-.35-1.2a1.1 1.1 0 0 0-.82-.37c-.35 0-.63.14-.85.42-.21.28-.32.71-.32 1.28v.4H5.1v-.2c0-.54-.11-.94-.35-1.22a1.18 1.18 0 0 0-.95-.43c-.31 0-.58.12-.8.35-.2.23-.31.55-.31.98 0 .72.36 1.19 1.07 1.4Zm42.84-5.02v3.43c0 .68-.03 1.19-.09 1.52a2.18 2.18 0 0 1-1.07 1.56c-.3.17-.63.26-1 .26-.4 0-.77-.1-1.11-.33a2 2 0 0 1-.76-.87 2.07 2.07 0 0 1-2.07 1.63 2.55 2.55 0 0 1-2.03-1.03c-.22-.3-.35-.7-.4-1.16A28.8 28.8 0 0 1 38 23.8v-2.92h8.59Zm-1.43 1.73h-1.99v1.14c0 .68.01 1.1.03 1.26.04.3.14.53.3.7.18.17.4.25.68.25.27 0 .48-.07.65-.22a.98.98 0 0 0 .3-.65c.02-.17.03-.66.03-1.48v-1Zm-3.42 0h-2.3v1.6c0 .63.02 1.03.06 1.2.05.26.16.46.34.63.18.16.43.24.73.24.26 0 .48-.06.66-.19.18-.12.3-.3.4-.54.07-.24.11-.75.11-1.54v-1.4Z" fill="#fff"/>` +
                    `</g>` +
                    `<path d="M21.65 15v-.65h-4.57L24 1.38l6.92 12.97h-4.57v33h-4.7V15Z" fill="red" stroke="#fff" stroke-width="1.3" transform="${headingRotate}"/>` +
                    '</svg>';
                return {
                    className: 'leaflet-control-locate-heading',
                    code
                }
            }
            _updateCompass() {
                let compassHeading = Math.round(this._map.locateEx._compassHeading);
                if (!compassHeading ||
                    compassHeading === this._lastHeading ||
                    !this._destination ||
                    !this._location
                ) return;

                this._lastHeading = compassHeading;

                const trueBearing = (360 + this.bearing(this._location, this._destination)) % 360;
                let heading = ((trueBearing - compassHeading) + 360) % 360;

                const arrowContainer = this._container.querySelector("#headingArrow") as HTMLSpanElement
                const headingArrowSvg = this._getIconSVG(heading, compassHeading);
                arrowContainer.innerHTML = headingArrowSvg.code;
                arrowContainer.style.width = "48";
                arrowContainer.style.height = "48";

                const courseValue = this._container.querySelector("#courseValue");
                courseValue.innerHTML = `курс ${Math.round(trueBearing)}°`;

                const normalizedHeading = compassHeading > 180 ? -360 + compassHeading : compassHeading;
                const normalizedTrueBearing = trueBearing > 180 ? -360 + trueBearing : trueBearing
                let courceDiffValue = (Math.round(normalizedHeading - normalizedTrueBearing) % 360);
                if (Math.abs(courceDiffValue) > 180) courceDiffValue = 360 - Math.abs(courceDiffValue);

                const courseDiff = this._container.querySelector("#courseDiff");
                courseDiff.innerHTML = ` ${courceDiffValue > 0 ? '<' : '>'}${Math.abs(courceDiffValue)}°`;
            }
            _updateControl() {
                if (!this._location || !this._destination) return;
                if (this._destination) {
                    if (!this._destinationLine) {
                        this._destinationLine = new L.Polyline<GeoJSON.LineString>([this._location, this._destination], this.options.destinationLineOptions)
                            .addTo(this._map);
                    }
                }

                const distance = this._destination.distanceTo(this._location);
                let value, units;
                if (distance < 1000) {
                    value = Math.round(distance);
                    units = `м`;
                }
                else if (distance < 10000) {
                    value = (distance / 1000).toFixed(2);
                    units = `км`;
                }
                else if (distance < 100000) {
                    value = (distance / 1000).toFixed(1);
                    units = `км`;
                }
                else {
                    value = Math.round(distance / 1000);
                    units = `км`;
                }
                this._container.querySelector("#distanceValue").innerHTML = value.toString();
                this._container.querySelector("#distanceUnits").innerHTML = units;
            }
        }
    }

    export function navigate(options?: L.Control.NavigateToOptions) {
        return new L.Control.NavigateTo(options);
    }
}
L.Map.mergeOptions({
    navigateControl: false,
});

L.Map.addInitHook(
    function (this: L.Map) {
        if (this.options.navigateControl) {
            this.navigate = L.navigate().addTo(this);
        }
    }
);