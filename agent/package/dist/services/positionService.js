export async function getPositions(client, address) {
    return client.position.listPositions(address);
}
