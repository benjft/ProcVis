class Bus {
    public readonly size: number
    public readonly maxValue: number
    protected value: number = 0

    public constructor(size: number) {
        if (size > 32) {
            console.log(`W:\tMax buss size of 32 bits due to arithmetic limitations.`)
            size = 32
        }

        this.size = size
        this.maxValue = 2**size - 1
    }

    public setValue(value: number) {
        if (!Number.isInteger(value)) {
            console.log(`W:\tInteger expected, found float (${value}) - rounding down`)
            value = Math.floor(value)
        }
        if (value > this.maxValue) {
            console.log(`W:\tValue (${value}) larger than maximum (${this.maxValue}) - truncating.`)
            value = value & this.maxValue
        }

        this.value = value
    }

    public getValue(): number {
        return this.value
    }

    public getBits(): boolean[] {
        return Array.from({length: this.size}, (_, i) => (this.value & (1<<i)) !== 0)
    }
}

class Register extends Bus {
    private inputBus: Bus
    private controlBus: Bus

    public constructor(size: number, inputBus: Bus, controlBus: Bus) {
        super(size)

        this.setInput(inputBus)

    }

    public setInput(inputBus: Bus) {
        this.inputBus = inputBus
    }

    public setControl(controlBus: Bus) {
        this.controlBus = controlBus
    }

    public setValue() {
        if (this.inputBus != null) {
            this.value = this.inputBus.getValue()
        }
    }
}

class Multiplexer extends Bus {
    private inputBusses: Bus[]
    private controlBus: Bus

    public constructor(size: number, controlBus: Bus = null, ...inputBusses: Bus[]) {
        super(size)
        this.setControl(controlBus)
        this.setInputs(...inputBusses)
    }

    public setControl(controlBus: Bus) {
        this.controlBus = controlBus
    }

    public setInputs(...inputBusses: Bus[]) {
        if (inputBusses != null && inputBusses.length > 0) {
            if (this.controlBus == null){
                console.log(`W:\tInputs defined, but no control to select them!`)
            } else if (this.controlBus.maxValue+1 < inputBusses.length){
                console.log(`W:\tControl Bus too small for number of inputs!`)
            }
        }
        this.inputBusses = inputBusses
    }


    public setValue(value: number) {
        console.log(`W:\tCannot set value of Multiplexer!`)
    }

    public getValue(): number {
        return this.inputBusses[this.controlBus.getValue()].getValue()
    }

    public getBits(): boolean[] {
        return this.inputBusses[this.controlBus.getValue()].getBits()
    }
}

class ArithmeticLogicUnit {
    private inputA: Bus
    private inputB: Bus

    private dataBus: Bus
    private controlBus: Bus // [enable, op1, op2, op3]
    private flags: Bus

    private value: number

    public update() {
        let op = this.controlBus.getValue()

        let a = this.inputA.getValue()
        let signA: number = +((a & (1<<(this.inputA.size-1))) == 0)

        let b = this.inputB.getValue()
        let signB: number = +((b & (1<<(this.inputB.size-1))) == 0)

        let res: number = 0
        let flgs = 0b0000 // [zero (<<3), sign (<<2), overflow (<<1), carry (<<0)]

        switch (op) {
            case 0b1000: // add
            case 0b1001:
                res = a + b
                break
            case 0b1010: // not A
                signB = +!signA // stop overflow flag
                res = (~a) & this.dataBus.maxValue
                break
            case 0b1011: //not B
                signA = +!signB // stop overflow flag
                res = (~b) & this.dataBus.maxValue
                break
            case 0b1100: // and
            case 0b1101:
                res = a & b
                break
            case 0b1110: // or
            case 0b1111:
                res = a | b
        }

        if (res > this.dataBus.maxValue) {
            res -= this.dataBus.maxValue
            flgs |= 1 << 0 // set carry flag
        }
        let signRes = +((res & (1<<(this.dataBus.size-1))) == 0)
        flgs |= signRes << 2 // set sign flag

        if (signA === signB) {
            flgs |= (signRes ^ signA) << 1 // set overflow flag
        }

        if (res === 0) {
            flgs |= 1 << 3 // set zero flag
        }
        this.dataBus.setValue(res)
        this.flags.setValue(flgs)
    }
}