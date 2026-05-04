import asyncio
from bleak import BleakClient

# Replace with your device's address and the characteristic UUID
DEVICE_ADDRESS = "71:BA:E3:49:2D:1B"
CHARACTERISTIC_UUID = "00002a37-0000-1000-8000-00805f9b34fb" # Example Heart Rate UUID

async def main(address):
    async with BleakClient(address) as client:
        if client.is_connected:
            print(f"Connected to {address}")
            # Reading data
            services = await client.get_services()
            for service in services:
                print(f"Service: {service.uuid}")
                for char in service.characteristics:
                    print(f"  - Characteristic: {char.uuid} (Properties: {char.properties})")

        else:
            print(f"Failed to connect to {address}")

asyncio.run(main(DEVICE_ADDRESS))
