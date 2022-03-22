
const WORD_SIZE = 8

const CTRL_SIZE_SET = 1
const CTRL_SIZE_SET_ENB = 2
const CTRL_SIZE_SET_ENB_INC = 3

const ALU_CTRL_SIZE = 3

type SVGinHTML = HTMLElement & SVGElement
type clockState = "loop" | "instruction" | "step"

class Simulation {
    private readonly dataBus: Bus

    private readonly ctrlIns: Bus
    private readonly regIns: Register

    private readonly ctrlPC: Bus
    private readonly regPC: Register

    private readonly ctrlRam: Bus
    private readonly ram: RAM

    private readonly ctrlAddress: Bus
    private readonly regAddress: Register

    private readonly ctrlA: Bus
    private readonly regA: Register

    private readonly ctrlB: Bus
    private readonly regB: Register

    private readonly ctrlT1: Bus
    private readonly regT1: Register

    private readonly ctrlT2: Bus
    private readonly regT2: Register

    private readonly ctrlALU: Bus
    private readonly alu: ArithmeticLogicUnit

    private readonly decoder: Decoder

    private readonly registers: Register[]
    private readonly busses: ReadOnlyBus[]

    public constructor() {
        this.dataBus = new Bus(WORD_SIZE)

        this.ctrlIns = new Bus(CTRL_SIZE_SET)
        this.regIns = new Register(WORD_SIZE, "ins", this.dataBus, this.ctrlIns)

        this.ctrlPC = new Bus(CTRL_SIZE_SET_ENB_INC)
        this.regPC = new Register(WORD_SIZE, "pc", this.dataBus, this.ctrlPC)

        this.ctrlAddress = new Bus(CTRL_SIZE_SET)
        this.regAddress = new Register(WORD_SIZE, "addr", this.dataBus, this.ctrlAddress)

        this.ctrlRam = new Bus(CTRL_SIZE_SET_ENB)
        this.ram = new RAM(WORD_SIZE, this.ctrlRam, this.regAddress, this.dataBus)
        this.initializeRamDisplay()

        this.ctrlA = new Bus(CTRL_SIZE_SET_ENB)
        this.regA = new Register(WORD_SIZE, "a", this.dataBus, this.ctrlA)

        this.ctrlB = new Bus(CTRL_SIZE_SET_ENB)
        this.regB = new Register(WORD_SIZE, "b", this.dataBus, this.ctrlB)

        this.ctrlT1 = new Bus(CTRL_SIZE_SET)
        this.regT1 = new Register(WORD_SIZE, "t1", this.dataBus, this.ctrlT1)

        this.ctrlT2 = new Bus(CTRL_SIZE_SET)
        this.regT2 = new Register(WORD_SIZE, "t2", this.dataBus, this.ctrlT2)

        this.ctrlALU = new Bus(ALU_CTRL_SIZE)
        this.alu = new ArithmeticLogicUnit(this.regT1, this.regT2, this.dataBus, this.ctrlALU)

        this.decoder = new Decoder(this.ctrlIns, this.regIns, this.ctrlPC, this.ctrlRam, this.ctrlA, this.ctrlB,
            this.ctrlT1, this.ctrlT2, this.ctrlAddress, this.ctrlALU, this.alu)

        this.registers = [this.regIns, this.regPC, this.regA, this.regB, this.regT1, this.regT2, this.regAddress]
        this.busses = [...this.registers,
            this.ctrlIns, this.ctrlPC, this.ctrlA, this.ctrlB, this.ctrlT1, this.ctrlT2, this.ctrlAddress,
            this.ctrlALU, this.alu, this.ctrlRam, this.dataBus
        ]
    }

    public reset() {
        this.busses.forEach(b => b.reset())
        this.decoder.reset()
    }

    public cycleDisplay(idx: number) {
        this.ram.data[idx].cycleDisplayMode()
        this.update_display()
    }
    private initializeRamDisplay() {
        let ramTBL = document.getElementById("ram-table")
        let ramHTML = (i: number, v: string) => `
<tr class="ram-word">
  <td class="inputLabel" onclick="sim.cycleDisplay(${i})">${i.toString(16).padStart(2, '0')}</td>
  <td><input id="ram-input${i}" class="inputArea" size="8" pattern="[01]{${WORD_SIZE}}" inputmode="numeric" value="${v}"></td>
</tr>`
        let innerHTML = ''
        this.ram.data.forEach((value, index) => {
            let rowHTML = ramHTML(index, value.getDisplayValue())
            innerHTML += rowHTML
        })
        ramTBL.innerHTML += innerHTML

        let inputs = Array.from(document.getElementsByClassName("inputArea"))
        inputs.forEach(elem => {
            elem.addEventListener("change", (e) => {
                let target = e.target as HTMLInputElement
                let idx = parseInt(target.id.replace("ram-input", ""))
                let ins = assembleInstruction(target.value)
                if (typeof ins == "string" || (ins.length > 1 && idx > (1 << WORD_SIZE)-1-ins.length)) {
                    target.value = this.ram.data[idx].getDisplayValue()
                } else {
                    while (ins.length > 0) {
                        let textBox = document.getElementById(`ram-input${idx}`) as HTMLInputElement
                        let value = ins.shift()
                        textBox.value = value.getDisplayValue()
                        this.ram.data[idx] = value
                        idx++
                    }
                }
            })
        })
    }



    private cleanBusses = () => this.busses.forEach(b => b.clean())
    public update_state() {
        this.cleanBusses()
        this.decoder.update()

        this.dataBus.setValue(0)
        this.dataBus.clean()

        this.registers.forEach(r => r.update_enable())
        this.registers.forEach(r => r.update_set())

        this.alu.update()
        this.ram.update()

        this.registers.forEach(r => r.update_set())
    }

    private setRamScroll() {
        let ramContainer = document.getElementById("ram-table").parentElement
        let ramIndex = this.regAddress.getValue()
        let ramRow = document.getElementById(`ram-input${ramIndex}`).parentElement.parentElement
        ramRow.classList.add("active")

        ramContainer.scrollTo(0, ramRow.offsetTop - ramRow.offsetHeight/2 - ramContainer.offsetHeight/2)
    }

    public update_display() {
        function update_bus(name: string, suffixes: string[], value: number) {
            for (let i = 0; i <= suffixes.length; i++) {
                let line = document.getElementById(`${name}${suffixes[i]}`)
                if (line == null) {
                    continue
                }

                line.classList.remove('high')
                if (value & (1 << i)) {
                    line.classList.add('high')
                }
            }
        }

        let data_value = this.dataBus.getValue()
        update_bus("data-line", "01234567".split(""), data_value)

        this.registers.forEach(r => {
            update_bus(`${r.name}-line`, "01234567".split(""), r.getValue())
            update_bus(`${r.name}-ctrl`, "-s -e -i".split(" "), r.controlBus.getValue())
            let textValue = document.getElementById(`${r.name}-value`) as SVGinHTML;
            textValue.textContent = r.getValue().toString(2).padStart(r.size, '0')
        })

        update_bus("alu-ctrl", "-0 -1 -2".split(" "), this.ctrlALU.getValue())
        update_bus("flgs", "-0 -1 -2 -3".split(" "), this.alu.getValue())
        update_bus("ram-ctrl", "-s -e".split(" "), this.ctrlRam.getValue())

        this.ram.data.forEach((value, index) => {
            let inputBox = document.getElementById(`ram-input${index}`) as HTMLInputElement
            inputBox.parentElement.parentElement.classList.remove("active")
            if (inputBox !== document.activeElement) {
                inputBox.value = value.getDisplayValue()
            }
        })
        this.setRamScroll()
    }

    public update() {
        if (this._state == null) {
            this._state = "step"
        }
        this.update_state()
        this.update_display()
        if (this._state == "step") {
            this._state = null
        }
    }

    public async update_loop() {
        if (this._state == null) {
            this._state = "instruction"
            this._stop = false
        }
        this.update()
        while (this.decoder.currentStep() != "fetch_step1" && !this._stop) {
            await sleep(250)
            this.update()
        }
        if (this._state == "instruction") {
            this._state = null
        }
    }


    private _stop: boolean = false
    public readonly stop = () => this._stop = true
    private _state: clockState | null = null
    public readonly state = () => this._state
    public async loop() {
        this._state = "loop"
        this._stop = false
        while (!this._stop) {
            await this.update_loop()
        }
        this._state = null
    }

    public loadProgram(program: string) {
        let programLines = program.split('\n')
        let words = programLines.map(assembleInstruction).flat()
        // this.ram.data = Array.from(this.ram.data, (_, k) => k < words.length ? words[k] : new RamWord())

        this.reset()
        this.ram.data.forEach((_, i) => {
            this.ram.data[i] = i < words.length ? words[i] : new RamWord()
        })
        sim.update_display()
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

let sim = new Simulation()

async function onButtonPress(button: clockState) {
    let currentState = sim.state()
    sim.stop()
    while (sim.state() != null) {
        await sleep(1)
    }

    if (currentState == button) {
        return
    }
    let buttonGroup = document.getElementById(`clock-${button}`)

    buttonGroup.classList.add("active")
    switch (button) {
        case "step":
            sim.update()
            break
        case "instruction":
            await sim.update_loop()
            break
        case "loop":
            await sim.loop()
    }
    buttonGroup.classList.remove("active")
}

const example_1 =
`jmp i
0x04
3
0
load i b
5
sub b i b
1
jlz i
0x08
load i a
0x05
save b a
load i a
0x02
load a a
load i b
0x03
load b b
add a b b
load i a
0x03
save b a
jmp i
0x04`
sim.loadProgram(example_1)
