interface Updatable {
    update()
}

abstract class ReadOnlyBus {
    readonly size: number
    readonly maxValue: number
    protected value: number = 0
    protected dirty: boolean = false

    protected listeners: Updatable[] = []
    public addBusListener(listener: Updatable) {
        this.listeners.push(listener);
    }

    public removeBusListener(listener: Updatable): boolean {
        let oldLen = this.listeners.length
        this.listeners = this.listeners.filter(v => v !== listener)
        return this.listeners.length !== oldLen
    }

    public getBusListeners(): Updatable[] {
        return [...this.listeners] // return shallow copy to prevent external mutation
    }

    constructor(size: number) {
        if (size > 31) {
            console.warn(`W:\tMax buss size of 31 bits due to arithmetic limitations.`)
            size = 31
        }

        this.size = size
        this.maxValue = 2**size - 1
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public clean() {
        this.dirty = false
    }

    public getValue(): number {
        return this.value
    }
}

class Bus extends ReadOnlyBus {

    public setValue(value: number) {
        if (this.isDirty()) {
            console.warn(`W:\tBus already modified this phase!`)
        }
        if (!Number.isInteger(value)) {
            console.warn(`W:\tInteger expected, found float (${value}) - rounding down`)
            value = Math.floor(value)
        }
        if (value > this.maxValue) {
            console.warn(`W:\tValue (${value}) larger than maximum (${this.maxValue}) - truncating.`)
            value = value & this.maxValue
        }

        this.value = value
        this.dirty = true
    }

    public getValue(): number {
        return this.value
    }
}

const CTRL_SET = 0b001
const CTRL_ENB = 0b010
const CTRL_INC = 0b100 // only used by program counter
class Register extends ReadOnlyBus implements Updatable {
    private dataBus: Bus
    private controlBus: Bus

    public constructor(size: number, inputBus: Bus, controlBus: Bus) {
        super(size)

        this.setInput(inputBus)
        this.setControl(controlBus)
    }

    public setInput(inputBus: Bus) {
        this.dataBus = inputBus
    }

    public setControl(controlBus: Bus) {
        this.controlBus = controlBus
    }

    public update() {
        switch (this.controlBus.getValue() & 0b111) {
            case CTRL_SET:
                this.value = this.dataBus.getValue()
                this.dirty = true
                break
            case CTRL_ENB:
                this.dataBus.setValue(this.value)
                break
            case CTRL_INC:
                this.value++
                this.dirty = true
        }
    }
}

// class Multiplexer extends Bus implements Updatable {
//     private inputBusses: Bus[]
//     private controlBus: Bus
//
//     public constructor(size: number, controlBus: Bus = null, ...inputBusses: Bus[]) {
//         super(size)
//         this.setControl(controlBus)
//         this.setInputs(...inputBusses)
//     }
//
//     public setControl(controlBus: Bus) {
//         this.controlBus = controlBus
//     }
//
//     public setInputs(...inputBusses: Bus[]) {
//         if (inputBusses != null && inputBusses.length > 0) {
//             if (this.controlBus == null){
//                 console.log(`W:\tInputs defined, but no control to select them!`)
//             } else if (this.controlBus.maxValue+1 < inputBusses.length){
//                 console.log(`W:\tControl Bus too small for number of inputs!`)
//             }
//         }
//         this.inputBusses = inputBusses
//     }
//
//     public setValue(value: number) {
//         console.log(`W:\tCannot set value of Multiplexer!`)
//     }
//
//     public getValue(): number {
//         return this.inputBusses[this.controlBus.getValue()].getValue()
//     }
//
//     public getBits(): boolean[] {
//         return this.inputBusses[this.controlBus.getValue()].getBits()
//     }
// }

const ALU_ADD  = 0b0001
const ALU_SUB  = 0b0010
const ALU_AND  = 0b0011
const ALU_OR   = 0b0100
const ALU_XOR  = 0b0101
const ALU_NOT  = 0b0110

const FLGS_Z = 0b1000
const FLGS_S = 0b0100
const FLGS_O = 0b0010
const FLGS_C = 0b0001
class ArithmeticLogicUnit implements Updatable {
    private inputA: Bus
    private inputB: Bus

    private dataBus: Bus
    private controlBus: Bus
    private flags: Bus

    public update() {
        let op = this.controlBus.getValue()
        if (!op) { // control not set
            return
        }

        let a = this.inputA.getValue()
        let signA: number = +((a & (1<<(this.inputA.size-1))) != 0)

        let b = this.inputB.getValue()
        let signB: number = +((b & (1<<(this.inputB.size-1))) != 0)

        let res: number = 0
        let flgs = 0b0000

        switch (op & 0b111) {
            case ALU_ADD:
                res = a + b
                break
            case ALU_SUB:
                res = a - b
                break
            case ALU_AND:
                res = a & b
                break
            case ALU_OR:
                res = a | b
                break
            case ALU_XOR:
                res = a ^ b
                break
            case ALU_NOT:
                res = (~a) & this.dataBus.maxValue
                break

        }

        if (res > this.dataBus.maxValue) {
            res -= this.dataBus.maxValue
            flgs |= FLGS_C // 1 << 0 // set carry flag
        }
        let signRes = +(1 & (res>>(this.dataBus.size-1)))
        flgs |= FLGS_S // signRes << 2 // set sign flag

        if (signA === signB) {
            flgs |= FLGS_O * (signA ^ signRes) // (signRes ^ signA) << 1 // set overflow flag
        }

        if (res === 0) {
            flgs |= FLGS_Z // 1 << 3 // set zero flag
        }
        this.dataBus.setValue(res)
        this.flags.setValue(flgs)
    }
}

const RAM_READ = 0b01
const RAM_WRITE = 0b10
class RAM  implements Updatable {
    private controlBus: Bus // [write, read]
    private addressBus: Bus

    private dataBus: Bus

    private data: number[]

    public update() {
        let address = this.addressBus.getValue()
        let value: number
        switch (this.controlBus.getValue()) {
            case RAM_READ:
                value = this.data[address]
                this.dataBus.setValue(value)
                break
            case RAM_WRITE:
                value = this.dataBus.getValue()
                this.data[address] = value
                break
            default: // No control or invalid control state
                break
        }
    }
}

const INS_RAM = 0b00
const INS_B_RAM_READ = 0b001
const INS_B_RAM_WRITE = 0b100

const INS_ALU_R = 0b01

const INS_ALU_I = 0b11

const INS_JMP = 0b10
const INS_JMP_JMP = 0b000
const INS_JMP_JLZ = 0b001
const INS_JMP_JGZ = 0b010
const INS_JMP_JEZ = 0b011

type funcFunc = () => funcFunc
class Decoder {
    private instructionControl: Bus
    private instructionBus: ReadOnlyBus
    private programControl: Bus // three lines [increment 0b100, enable 0b010, set 0b001]
    private ramControl: Bus
    private registerAControl: Bus
    private registerBControl: Bus
    private registerT1Control: Bus
    private registerT2Control: Bus
    private addressControl: Bus
    private aluControl: Bus
    private flags: ReadOnlyBus

    private currentInstruction: funcFunc = this.fetch_step1

    private fetch_step1(): funcFunc {
        this.programControl.setValue(CTRL_ENB)
        this.addressControl.setValue(CTRL_SET)
        return this.fetch_step2
    }

    private fetch_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.fetch_step3
    }

    private fetch_step3(): funcFunc {
        this.programControl.setValue(0)
        this.ramControl.setValue(CTRL_ENB)
        this.instructionControl.setValue(CTRL_SET)
        return this.fetch_step4
    }

    private fetch_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.instructionControl.setValue(0)
        return this.execute
    }

    private execute(): funcFunc {
        // instructions built as TT III SS D (T->Type, I->Instruction, S->Source, D->Destination)
        let ins = this.instructionBus.getValue()
        let ins_type = ins >> 6 // get only type bits from instruction

        if (ins == 0) {
            return this.fetch_step1()
        }
        switch (ins_type & 0b11) {
            case INS_RAM:
                return this.execute_ram_step1()
            case INS_ALU_I:
                return this.execute_alui_step1()
            case INS_ALU_R:
                return this.execute_alur_step1()
            case INS_JMP:
                return this.execute_jump()
        }
        return this.fetch_step1()
    }

    private execute_ram_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2) // 1 if immediate, 0 if register
        let ins_src_reg = 1 & (ins >> 1) // 0 for A, 1 for B
        if (ins_immediate) {
            this.programControl.setValue(CTRL_ENB)
        } else if (ins_src_reg === 0) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }
        this.addressControl.setValue(CTRL_SET)
        return this.execute_ram_step2
    }

    private execute_ram_step2(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2) // 1 if immediate, 0 if register
        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC)
        } else {
            this.registerAControl.setValue(0)
            this.registerBControl.setValue(0)
        }
        this.addressControl.setValue(0)
        return this.execute_ram_step3
    }

    private execute_ram_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_dest_reg = 1 & (ins >> 0) // 0 for A, 1 for B
        let ins_body = 0b111 & (ins >> 3)
        this.programControl.setValue(0) // just in case

        let ramRW: number
        let regRW: number
        switch (ins_body) {
            case INS_B_RAM_READ:
                ramRW = CTRL_ENB
                regRW = CTRL_SET
                break
            case INS_B_RAM_WRITE:
            default:
                ramRW = CTRL_SET
                regRW = CTRL_ENB
        }

        this.ramControl.setValue(ramRW)
        if (ins_dest_reg == 0) {
            this.registerAControl.setValue(regRW)
        } else {
            this.registerBControl.setValue(regRW)
        }
        return this.execute_ram_step4
    }

    private execute_ram_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        return this.fetch_step1
    }

    private execute_alui_step1(): funcFunc {
        this.programControl.setValue(CTRL_ENB)
        this.addressControl.setValue(CTRL_SET)
        return this.execute_alui_step2
    }

    private execute_alui_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.execute_alui_step3
    }

    private execute_alui_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t = 1 & (ins >> 2)

        this.programControl.setValue(0)
        this.ramControl.setValue(CTRL_ENB)

        if (ins_t == 0) {
            this.registerT1Control.setValue(CTRL_SET)
        } else {
            this.registerT2Control.setValue(CTRL_SET)
        }

        return this.execute_alui_step4
    }

    private execute_alui_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerT1Control.setValue(0)
        this.registerT2Control.setValue(0)

        return this.execute_alui_step5
    }

    private execute_alui_step5(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t = 1 & (ins >> 2)
        let ins_r = 1 & (ins >> 1)

        if (ins_r == 0) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }

        if (ins_t == 0) {
            this.registerT2Control.setValue(CTRL_SET)
        } else {
            this.registerT1Control.setValue(CTRL_SET)
        }

        return this.execute_alui_step6
    }

    private execute_alui_step6(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT1Control.setValue(0)
        this.registerT2Control.setValue(0)

        return this.execute_alu_step7
    }

    private execute_alur_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t1 = 1 & (ins >> 2)

        if (ins_t1) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }
        this.registerT1Control.setValue(CTRL_SET)

        return this.execute_alur_step2
    }

    private execute_alur_step2(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT1Control.setValue(0)

        return this.execute_alur_step3
    }

    private execute_alur_step3(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_t2 = 1 & (ins >> 1)

        if (ins_t2) {
            this.registerAControl.setValue(CTRL_ENB)
        } else {
            this.registerBControl.setValue(CTRL_ENB)
        }
        this.registerT2Control.setValue(CTRL_SET)

        return this.execute_alur_step4
    }

    private execute_alur_step4(): funcFunc {
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.registerT2Control.setValue(0)

        return this.execute_alu_step7
    }

    private execute_alu_step7(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_body = 0b111 & (ins >> 3)
        let ins_dest = 1 & ins

        this.aluControl.setValue(ins_body)
        if (ins_dest == 0) {
            this.registerAControl.setValue(CTRL_SET)
        } else {
            this.registerBControl.setValue(CTRL_SET)
        }
        return this.execute_alu_step8
    }

    private execute_alu_step8(): funcFunc {
        this.aluControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        return this.fetch_step1
    }

    private execute_jump(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_body = 0b111 & (ins >> 3)
        let ins_immediate = 1 & (ins >> 2)

        let condition_flag = true
        if (ins_body == INS_JMP_JEZ) {
            if (!(this.flags.getValue() & FLGS_Z)) {
                condition_flag = false
            }
        } else if (ins_body == INS_JMP_JGZ) {
            if ((this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false
            }
        } else if (ins_body == INS_JMP_JLZ) {
            if (!(this.flags.getValue() & FLGS_S) || this.flags.getValue() & FLGS_Z) {
                condition_flag = false
            }
        }

        if (condition_flag) {
            return this.execute_jump_step1()
        }

        if (ins_immediate) {
            this.programControl.setValue(CTRL_INC)
            return this.execute_jump_step4
        } else {
            return this.fetch_step1()
        }
    }

    private execute_jump_step1(): funcFunc {
        let ins = this.instructionBus.getValue()
        let ins_immediate = 1 & (ins >> 2)
        let ins_register = 1 & (ins >> 1)

        if (ins_immediate) {
            this.programControl.setValue(CTRL_ENB)
            this.addressControl.setValue(CTRL_SET)
            return this.execute_jump_step2
        } else {
            if (ins_register == 0) {
                this.registerAControl.setValue(CTRL_ENB)
            } else {
                this.registerBControl.setValue(CTRL_ENB)
            }
            this.programControl.setValue(CTRL_SET)
            return this.execute_jump_step4
        }
    }

    private execute_jump_step2(): funcFunc {
        this.programControl.setValue(CTRL_INC)
        this.addressControl.setValue(0)
        return this.execute_jump_step3
    }

    private execute_jump_step3(): funcFunc {
        this.ramControl.setValue(CTRL_ENB)
        this.programControl.setValue(CTRL_SET)
        return this.execute_jump_step4
    }

    private execute_jump_step4(): funcFunc {
        this.ramControl.setValue(0)
        this.registerAControl.setValue(0)
        this.registerBControl.setValue(0)
        this.programControl.setValue(0)
        return this.fetch_step1
    }

    public update() {
        this.currentInstruction = this.currentInstruction()
    }
}
