// Minimal Web Bluetooth ambient types — TypeScript's lib.dom.d.ts doesn't
// include them yet (still considered experimental by the standards body).
// See https://webbluetoothcg.github.io/web-bluetooth/ for the spec.

interface Navigator {
    bluetooth: Bluetooth;
}

type BluetoothServiceUUID = number | string;
type BluetoothCharacteristicUUID = number | string;

interface Bluetooth extends EventTarget {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
    getDevices?(): Promise<BluetoothDevice[]>;
}

interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
}

interface BluetoothLEScanFilter {
    services?: BluetoothServiceUUID[];
    name?: string;
    namePrefix?: string;
}

interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string;
    readonly gatt?: BluetoothRemoteGATTServer;
    addEventListener(type: 'gattserverdisconnected', listener: (this: this, ev: Event) => void): void;
    removeEventListener(type: 'gattserverdisconnected', listener: (this: this, ev: Event) => void): void;
}

interface BluetoothRemoteGATTServer {
    readonly device: BluetoothDevice;
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothRemoteGATTService {
    readonly uuid: string;
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothCharacteristicProperties {
    readonly write: boolean;
    readonly writeWithoutResponse: boolean;
    readonly read: boolean;
    readonly notify: boolean;
    readonly indicate: boolean;
}

interface BluetoothRemoteGATTCharacteristic {
    readonly uuid: string;
    readonly properties: BluetoothCharacteristicProperties;
    writeValue(value: BufferSource): Promise<void>;
    writeValueWithResponse(value: BufferSource): Promise<void>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
    readValue(): Promise<DataView>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}
