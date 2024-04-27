class DataTransformer {
    constructor(head = []) {
        this.HEAD = Buffer.from(head || [])
    }

    /**
     * @param {Object} data
     */
    encode(data) {
        // key:value;key:value;stream!:...
        const b64encode = (s) => Buffer.from(s).toString("base64")
        let keys = Object.keys(data)
        let buffers = [this.HEAD]
        let raw_buffer = null;
        for (let k of keys) {
            if (k !== "stream") {
                buffers.push(Buffer.from(b64encode(k) + ":" + b64encode(JSON.stringify(data[k]).toString()) + ";"))
            }
            if (k === "stream") {
                raw_buffer = data[k]
            }
        }
        if (raw_buffer !== null) {
            buffers.push(Buffer.from("stream!:"))
            buffers.push(raw_buffer)
        }
        return Buffer.concat(buffers)
    }

    /**
     * @param {Buffer} buf
     * @returns {{[k:string]: any, stream?: Buffer}}
     * @throws {Error}
     */
    decode(buf) {
        if (!this.isThis(buf)) {
            throw new Error("Invalid data")
        } else {
            if (typeof buf === "string") {
                buf = Buffer.from(buf)
            }
            buf = buf.subarray(this.HEAD.length)
        }
        let data = {}
        // key:value;key:value;stream!:...
        const b64decode = (s) => Buffer.from(s, "base64").toString()
        let start = 0, end = 0, key = ""
        for (let c of buf) {
            if (c === 0x21) { // !
                data["stream"] = buf.subarray(end + 2)
                break
            }
            if (c === 0x3a) { // :
                key = b64decode(buf.subarray(start, end).toString())
                start = end + 1
            }
            if (c === 0x3b) { // ;
                data[key] = JSON.parse(b64decode(buf.subarray(start, end).toString()))
                start = end + 1
            }
            end++
        }
        return data
    }

    isThis(buf) {
        if (!(Buffer.isBuffer(buf) || typeof buf === "string")) {
            return false
        }
        if (typeof buf === "string") {
            buf = Buffer.from(buf)
        }
        return buf.subarray(0, this.HEAD.length).equals(this.HEAD)
    }
}

module.exports = DataTransformer